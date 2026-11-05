import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const url=Deno.env.get("SUPABASE_URL")!, secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(url,secret,{auth:{persistSession:false}});
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
function reply(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}})}
function fail(message:string,status=400){return reply({error:message},status)}
const supported=["application/pdf","image/jpeg","image/png","image/webp"];
const WORKER="https://printpilot-r2-gateway.pranavvalluru.workers.dev";
const makeToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,"0")).join("");
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,"0")).join("");
async function cap(order_id:string,object_key:string,operation:"upload"|"head"|"delete",mime_type:string,ttl=120000){
 const token=makeToken(),hash=await sha(token);
 const {error}=await admin.from("printpilot_r2_capabilities").insert({token_sha256:hash,order_id,object_key,operation,expires_at:new Date(Date.now()+ttl).toISOString(),max_bytes:5242880,mime_type});
 if(error)throw error;return {token,hash};
}
async function uncap(hash:string){await admin.from("printpilot_r2_capabilities").delete().eq("token_sha256",hash)}

Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST")return fail("Method not allowed",405);
 try{
 const body=await req.json(), action=body.action;
 if(action==="shop"){
  const slug=String(body.slug||"").slice(0,100);
  const {data,error}=await admin.from("shops").select("id,name,slug,bw_price,color_price,upi_id").eq("slug",slug).eq("is_active",true).maybeSingle();
  if(error||!data)return fail("Shop not found",404);
  return reply({shop:data});
 }

 if(action==="track"){
  const id=String(body.order_id||""),token=String(body.token||"");
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)||!/^[a-f0-9]{64}$/i.test(token))return fail("Invalid tracking code",400);
  const {data:o,error:e}=await admin.from("orders")
   .select("id,shop_id,status,upload_state,total_amount,created_at,print_window_expires_at,cloud_deleted_at,tracking_token_sha256")
   .eq("id",id).eq("tracking_token_sha256",await sha(token)).maybeSingle();
  if(e||!o)return fail("Tracking code not found",404);
  const {data:shop}=await admin.from("shops").select("name").eq("id",o.shop_id).maybeSingle();
  const status=o.cloud_deleted_at&&o.status==="printed"?"completed":o.status==="received"&&o.upload_state==="ready"?"waiting":o.status;
  const expires=o.print_window_expires_at||new Date(Date.parse(o.created_at)+3600000).toISOString();
  return reply({order:{id:o.id,shop:shop?.name||"Print shop",status,created_at:o.created_at,amount:o.total_amount,expires_at:expires,files_deleted:!!o.cloud_deleted_at}});
 }
 if(action==="submit"){
  const slug=String(body.slug||"").slice(0,100);
  const {data:shop}=await admin.from("shops").select("id,bw_price,color_price").eq("slug",slug).eq("is_active",true).maybeSingle();
  if(!shop)return fail("Invalid shop code",404);
  // Prevent anonymous uploads from generating unbounded R2 operations.
  const today=new Date();today.setUTCHours(0,0,0,0);
  const {count:dailyCount,error:limitError}=await admin.from("orders")
   .select("id",{count:"exact",head:true}).eq("shop_id",shop.id).gte("created_at",today.toISOString());
  if(limitError)return fail("Could not check shop daily limit",503);
  if((dailyCount||0)>=200)return fail("This shop has reached its daily order limit",429);
  const incoming=Array.isArray(body.files)?body.files:(body.file?[{...body.file,pages:body.pages}]:[]);
  if(incoming.length<1||incoming.length>5)return fail("Choose 1 to 5 documents");
  const prepared: {name:string;mime:string;raw:Uint8Array;pages:number}[]=[];
  let totalBytes=0,totalPages=0;
  for(const f of incoming){
   const mime=String(f.type||""),b64=String(f.data||""),pages=Number(f.pages);
   if(!supported.includes(mime))return fail("PDF/JPG/PNG/WEBP only");
   if(!Number.isInteger(pages)||pages<1||pages>500)return fail("Invalid page count");
   if(b64.length<10||b64.length>7_000_000)return fail("Maximum 5 MB per file");
   const raw=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
   if(!raw.length||raw.length>5*1024*1024)return fail("Maximum 5 MB per file");
   totalBytes+=raw.length;totalPages+=pages;
   if(totalBytes>12*1024*1024)return fail("Maximum 12 MB per order");
   if(totalPages>500)return fail("Maximum 500 pages per order");
   const signature=Array.from(raw.slice(0,8)).map(n=>n.toString(16).padStart(2,"0")).join("");
   if(mime==="application/pdf"&&!signature.startsWith("25504446"))return fail("Invalid PDF");
   if(mime==="image/png"&&!signature.startsWith("89504e47"))return fail("Invalid PNG");
   if(mime==="image/jpeg"&&!signature.startsWith("ffd8"))return fail("Invalid JPEG");
   if(mime==="image/webp"&&String.fromCharCode(...raw.slice(0,4))!=="RIFF")return fail("Invalid WEBP");
   prepared.push({name:String(f.name||"document").replace(/[^\w. -]/g,"_").slice(0,95),mime,raw,pages});
  }
  const copies=Number(body.copies);
  if(!Number.isInteger(copies)||copies<1||copies>100)return fail("Invalid copies");
  const color=body.color==="color"?"color":"bw",paper=String(body.paper||"A4"),edge=String(body.edge||"long-edge");
  if(!["A4","A3","A5","Letter"].includes(paper)||!["long-edge","short-edge"].includes(edge))return fail("Invalid print settings");
  const amount=Number((totalPages*copies*Number(color==="color"?shop.color_price:shop.bw_price)).toFixed(2));
  // UPI remains disabled until shop QR synchronization is verified.
  if(body.payment!=="counter")return fail("Select Pay at counter");
  const trackingToken=makeToken();
  const {data:order,error:oe}=await admin.from("orders").insert({
   shop_id:shop.id,status:"received",upload_state:"pending",copies,page_count:totalPages,color_mode:color,
   duplex:!!body.duplex,paper_size:paper,print_edge:edge,total_amount:amount,
   payment_status:"pay_at_counter",customer_name:String(body.customer||"").slice(0,50),
   notes:String(body.notes||"").slice(0,240),tracking_token_sha256:await sha(trackingToken)
  }).select("id").single();
  if(oe||!order)return fail("Could not save order",500);
  const attempted:{path:string;mime:string}[]=[];
  try{
   for(const f of prepared){
    const extension=f.mime==="application/pdf"?".pdf":f.mime==="image/png"?".png":f.mime==="image/webp"?".webp":".jpg";
    const path=shop.id+"/"+order.id+"/"+crypto.randomUUID()+extension;
    const {error:de}=await admin.from("documents").insert({
     order_id:order.id,storage_path:path,original_name:f.name,encrypted:false,
     storage_provider:"r2",upload_state:"pending",delete_after:new Date(Date.now()+3600000).toISOString()
    });
    if(de)throw de;
    attempted.push({path,mime:f.mime});
    const upload=await cap(order.id,path,"upload",f.mime,180000);
    try{
     const response=await fetch(WORKER+"?key="+encodeURIComponent(path),{
      method:"PUT",headers:{"Content-Type":f.mime,"x-printpilot-capability":upload.token},body:f.raw,redirect:"error"
     });
     if(!response.ok)throw Error("R2 upload returned "+response.status);
     const data=await response.json();if(data.size!==f.raw.length)throw Error("R2 upload size mismatch");
    }finally{await uncap(upload.hash)}
    const head=await cap(order.id,path,"head",f.mime,120000);
    try{
     const response=await fetch(WORKER+"?key="+encodeURIComponent(path),{
      method:"HEAD",headers:{"x-printpilot-capability":head.token},redirect:"error"
     });
     if(!response.ok||Number(response.headers.get("content-length"))!==f.raw.length)throw Error("R2 verification failed");
    }finally{await uncap(head.hash)}
    const {error:ready}=await admin.from("documents").update({upload_state:"ready"}).eq("order_id",order.id).eq("storage_path",path);
    if(ready)throw ready;
   }
   const {error:readyOrder}=await admin.from("orders").update({upload_state:"ready"}).eq("id",order.id);
   if(readyOrder)throw readyOrder;
  }catch(e){
   console.error("PrintPilot multi-file upload failed",e);
   // Cancel immediately to block printing, but retain metadata until every object is removed.
   await admin.from("orders").update({status:"cancelled",upload_state:"failed",completion_source:"upload_failed_cleanup_pending"}).eq("id",order.id);
   let cleaned=true;
   for(const f of attempted){
    try{
     const deletion=await cap(order.id,f.path,"delete",f.mime,120000);
     try{
      const response=await fetch(WORKER+"?key="+encodeURIComponent(f.path),{method:"DELETE",headers:{"x-printpilot-capability":deletion.token},redirect:"error"});
      if(!response.ok)throw Error("R2 rollback failed");
      const result=await response.json();if(!result.ok||!result.deleted)throw Error("R2 rollback unverified");
     }finally{await uncap(deletion.hash)}
     await admin.from("documents").update({deleted_at:new Date().toISOString()}).eq("order_id",order.id).eq("storage_path",f.path);
    }catch(cleanup){cleaned=false;console.error("R2 rollback retry scheduled",cleanup)}
   }
   if(cleaned)await admin.from("orders").update({cloud_deleted_at:new Date().toISOString(),completion_source:"upload_failed_cleaned"}).eq("id",order.id);
   return fail("Document upload failed. Please retry.",503);
  }
  return reply({order_id:order.id,amount,tracking_token:trackingToken,files:prepared.length});
 }
 return fail("Unknown action");
 }catch(e){console.error(e);return fail("Request could not be processed",400)}
});