import {createClient} from "npm:@supabase/supabase-js@2.57.0";
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const worker="https://printpilot-r2-gateway.pranavvalluru.workers.dev";
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json"}});
const uuid=(x:string)=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const newToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,"0")).join("");
const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,"0")).join("");
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:C});
 if(req.method!=="POST")return json({error:"POST required"},405);
 const bearer=req.headers.get("authorization")||"";
 if(!bearer.startsWith("Bearer "))return json({error:"Login required"},401);
 const {data:{user},error:ae}=await db.auth.getUser(bearer.slice(7));
 if(ae||!user)return json({error:"Session expired"},401);
 let capHash="";
 try{
  const b=await req.json(),id=String(b.order_id||""),requestedKey=String(b.key||"");
  if(!uuid(id))return json({error:"Invalid order"},400);
  const {data:order}=await db.from("orders").select("id,shop_id,status,payment_status,print_window_expires_at,cloud_deleted_at").eq("id",id).maybeSingle();
  if(!order)return json({error:"Order not found"},404);
  const {data:shop}=await db.from("shops").select("owner_id,is_active").eq("id",order.shop_id).maybeSingle();
  if(!shop?.is_active||shop.owner_id!==user.id)return json({error:"Shop access denied"},403);
  if(order.payment_status!=="verified"||order.status!=="printing"||order.cloud_deleted_at||!order.print_window_expires_at||Date.parse(order.print_window_expires_at)<=Date.now())return json({error:"Print window is closed"},409);
  const {data:doc}=await db.from("documents").select("storage_path,original_name,upload_state,deleted_at").eq("order_id",id).eq("storage_provider","r2").eq("storage_path",requestedKey).maybeSingle();
  if(!requestedKey||!/^[-a-f0-9]{36}\/[-a-f0-9]{36}\/[-a-f0-9]{36}\.(pdf|png|jpg|webp)$/.test(requestedKey)||!doc||doc.deleted_at||doc.upload_state!=="ready")return json({error:"R2 document unavailable"},404);
  const type=doc.storage_path.endsWith(".pdf")?"application/pdf":doc.storage_path.endsWith(".png")?"image/png":doc.storage_path.endsWith(".webp")?"image/webp":"image/jpeg";
  const token=newToken();capHash=await digest(token);
  const {error:ce}=await db.from("printpilot_r2_capabilities").insert({token_sha256:capHash,order_id:id,object_key:doc.storage_path,operation:"read",expires_at:new Date(Date.now()+60000).toISOString(),max_bytes:5242880,mime_type:type});
  if(ce)throw ce;
  const response=await fetch(worker+"?key="+encodeURIComponent(doc.storage_path),{headers:{"x-printpilot-capability":token},redirect:"error"});
  if(!response.ok)return json({error:"Document could not be opened; retry before the timer expires"},response.status===403?403:503);
  const data=await response.arrayBuffer();
  if(data.byteLength>5242880)throw Error("Unexpected document size");
  return new Response(data,{status:200,headers:{...C,"Content-Type":type,"Content-Disposition":"inline; filename=\"print-document\""}});
 }catch(e){console.error("R2 read failed",e);return json({error:"Secure document service unavailable"},503)}
 finally{if(capHash)await db.from("printpilot_r2_capabilities").delete().eq("token_sha256",capHash)}
});