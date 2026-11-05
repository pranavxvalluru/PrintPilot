import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const url=Deno.env.get("SUPABASE_URL")!;
const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(url,key,{auth:{persistSession:false}});
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const out=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{status,headers:C});
const uuid=(id:string)=>/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);
async function allowedCron(req:Request){
 const token=req.headers.get("x-printpilot-cron")||"";
 if(!/^[a-f0-9]{64}$/.test(token))return false;
 const {data,error}=await db.from("printpilot_cleanup_config").select("token_sha256").eq("id",1).single();
 if(error||!data?.token_sha256)return false;
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
 const hex=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
 let mismatch=0;for(let i=0;i<64;i++)mismatch|=hex.charCodeAt(i)^String(data.token_sha256).charCodeAt(i);
 return mismatch===0;
}
const WORKER="https://printpilot-r2-gateway.pranavvalluru.workers.dev";
const makeToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,"0")).join("");
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,"0")).join("");
async function removeR2(orderId:string,key:string){
 const token=makeToken(),hash=await sha(token);
 const mime=key.endsWith(".pdf")?"application/pdf":key.endsWith(".png")?"image/png":key.endsWith(".webp")?"image/webp":"image/jpeg";
 const {error:ce}=await db.from("printpilot_r2_capabilities").insert({token_sha256:hash,order_id:orderId,object_key:key,operation:"delete",expires_at:new Date(Date.now()+120000).toISOString(),max_bytes:5242880,mime_type:mime});
 if(ce)throw ce;
 try{
  const r=await fetch(WORKER+"?key="+encodeURIComponent(key),{method:"DELETE",headers:{"x-printpilot-capability":token},redirect:"error"});
  if(!r.ok)throw Error("R2 delete returned "+r.status);
  const j=await r.json();if(!j.ok||!j.deleted)throw Error("R2 deletion not verified");
 }finally{await db.from("printpilot_r2_capabilities").delete().eq("token_sha256",hash)}
}
async function removeDocuments(orderId:string){
 const {data:docs,error:de}=await db.from("documents").select("id,storage_path,storage_provider,deleted_at").eq("order_id",orderId);
 if(de)throw de;
 const pending=(docs||[]).filter(d=>!d.deleted_at);
 const supabase=pending.filter(d=>d.storage_provider!=="r2").map(d=>d.storage_path as string);
 if(supabase.length){
  const bucket=db.storage.from("print-documents");
  const {error:re}=await bucket.remove(supabase);if(re)throw Error("Supabase deletion: "+re.message);
  for(const directory of new Set(supabase.map(p=>p.split("/").slice(0,2).join("/")))){
   let offset=0;
   while(true){
    const {data:remaining,error:le}=await bucket.list(directory,{limit:100,offset});
    if(le)throw Error("Storage verify: "+le.message);
    if((remaining||[]).some(f=>supabase.includes(directory+"/"+f.name)))throw Error("Supabase file still present");
    if(!remaining||remaining.length<100)break;
    offset+=100;if(offset>10000)throw Error("Storage listing exceeded safe limit");
   }
  }
 }
 for(const doc of pending.filter(d=>d.storage_provider==="r2"))await removeR2(orderId,doc.storage_path);
 if(pending.length){
  const {error:me}=await db.from("documents").update({deleted_at:new Date().toISOString()}).eq("order_id",orderId).is("deleted_at",null);
  if(me)throw Error("Delete metadata: "+me.message);
 }
 return pending.length;
}
async function finalize(o:{id:string;status:string;print_window_expires_at:string}){
 if(o.status!=="printing"||Date.parse(o.print_window_expires_at)>Date.now())return false;
 await removeDocuments(o.id);
 const now=new Date().toISOString();
 const {data:completed,error:ce}=await db.from("orders")
  .update({status:"printed",printed_at:now,cloud_deleted_at:now,completion_source:"auto_timer"})
  .eq("id",o.id).eq("status","printing").lte("print_window_expires_at",now).is("cloud_deleted_at",null).select("id").maybeSingle();
 if(ce)throw Error("Completion: "+ce.message);
 return !!completed;
}
async function cleanupAbandoned(o:{id:string;created_at:string}){
 const cutoff=new Date(Date.now()-3600000).toISOString();
 // Claim the order first, so a concurrent owner cannot start printing during deletion.
 const {data:claimed,error:ce}=await db.from("orders")
  .update({status:"cancelled",completion_source:"abandoned_1h_pending"})
  .eq("id",o.id).in("status",["received","verified","cancelled"])
  .is("cloud_deleted_at",null).is("print_window_started_at",null)
  .lte("created_at",cutoff).select("id").maybeSingle();
 if(ce)throw ce;
 if(!claimed)return false;
 await removeDocuments(o.id);
 const now=new Date().toISOString();
 const {data:updated,error:ue}=await db.from("orders")
  .update({cloud_deleted_at:now,completion_source:"abandoned_1h"})
  .eq("id",o.id).eq("status","cancelled").is("cloud_deleted_at",null)
  .select("id").maybeSingle();
 if(ue)throw ue;return !!updated;
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:C});
 if(req.method!=="POST")return out({error:"POST required"},405);
 try{
  const body=await req.json(),action=String(body?.action||"");
  if(action==="cleanup_due"){
   if(!await allowedCron(req))return out({error:"Scheduler unauthorized"},403);
   const {data:due,error:qe}=await db.from("orders").select("id,status,print_window_expires_at")
    .eq("status","printing").lte("print_window_expires_at",new Date().toISOString())
    .is("cloud_deleted_at",null).order("print_window_expires_at",{ascending:true}).limit(40);
   if(qe)throw qe;
   let completed=0,failed=0;
   for(const order of due||[]){
    try{if(await finalize(order))completed++}
    catch(e){failed++;console.error("PrintPilot scheduled cleanup failed",order.id,e)}
   }
   const cutoff=new Date(Date.now()-3600000).toISOString();
   const {data:abandoned,error:ae}=await db.from("orders").select("id,created_at").in("status",["received","verified","cancelled"]).lt("created_at",cutoff).is("cloud_deleted_at",null).is("print_window_started_at",null).order("created_at",{ascending:true}).limit(40);
   if(ae)throw ae;
   let abandonedDeleted=0;
   for(const old of abandoned||[]){try{if(await cleanupAbandoned(old))abandonedDeleted++}catch(e){failed++;console.error("Abandoned order cleanup failed",old.id,e)}}
   return out({ok:true,completed,abandonedDeleted,failed,examined:(due||[]).length});
  }
  if(action!=="begin_window")return out({error:"Unknown action"},400);
  const bearer=req.headers.get("authorization")||"";
  if(!bearer.startsWith("Bearer "))return out({error:"Login required"},401);
  const {data:{user},error:auth}=await db.auth.getUser(bearer.substring(7));
  if(auth||!user)return out({error:"Invalid session"},401);
  const id=String(body.order_id||"");
  if(!uuid(id))return out({error:"Invalid order ID"},400);
  const {data:o,error:oe}=await db.from("orders")
   .select("id,shop_id,status,payment_status,created_at,cloud_deleted_at,print_window_started_at,print_window_expires_at,upload_state")
   .eq("id",id).maybeSingle();
  if(oe||!o)return out({error:"Order not found"},404);
  const {data:shop}=await db.from("shops").select("owner_id,is_active").eq("id",o.shop_id).maybeSingle();
  if(!shop||shop.owner_id!==user.id||!shop.is_active)return out({error:"Unauthorized shop"},403);
  if(Date.parse(o.created_at)+3600000<=Date.now()&&!o.print_window_started_at)return out({error:"This unstarted order expired after one hour. Please place a new order."},409);
  if(o.upload_state!=="ready")return out({error:"Document upload is not finished"},409);
  if(o.payment_status!=="verified")return out({error:"Confirm payment before printing"},409);
  if(!["received","verified","printing"].includes(o.status)||o.cloud_deleted_at)return out({error:"Order already closed"},409);
  if(o.print_window_started_at)return out({ok:true,status:"printing",print_window_expires_at:o.print_window_expires_at,reused:true});
  const started=new Date(),expires=new Date(started.getTime()+300000).toISOString();
  const {data:updated,error:ue}=await db.from("orders")
   .update({status:"printing",print_window_started_at:started.toISOString(),print_window_expires_at:expires})
   .eq("id",id).in("status",["received","verified","printing"]).is("print_window_started_at",null)
   .select("print_window_expires_at").maybeSingle();
  if(ue)throw ue;
  if(!updated){
   const {data:fresh}=await db.from("orders").select("status,print_window_expires_at").eq("id",id).single();
   if(!fresh?.print_window_expires_at||fresh.status!=="printing")return out({error:"Order changed, refresh and retry"},409);
   return out({ok:true,status:"printing",print_window_expires_at:fresh.print_window_expires_at,reused:true});
  }
  return out({ok:true,status:"printing",print_window_expires_at:updated.print_window_expires_at,reused:false});
 }catch(e){console.error("PrintPilot print-window function failed",e);return out({error:"Print service failed; please retry"},500)}
});