import {createClient} from "npm:@supabase/supabase-js@2.57.0";
const root=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
function json(v:unknown,s=200){return new Response(JSON.stringify(v),{status:s,headers:{...C,"Content-Type":"application/json","Cache-Control":"no-store"}})}
Deno.serve(async req=>{
if(req.method==="OPTIONS")return new Response(null,{headers:C});
if(req.method!=="POST")return json({error:"POST required"},405);
const bearer=req.headers.get("authorization")||"";
if(!bearer.startsWith("Bearer "))return json({error:"Admin login required"},401);
const {data:{user},error:ue}=await root.auth.getUser(bearer.slice(7));
if(ue||!user)return json({error:"Invalid session"},401);
const {data:admin}=await root.from("platform_admins").select("user_id").eq("user_id",user.id).maybeSingle();
if(!admin)return json({error:"Super Admin access required"},403);
try{
const x=await req.json();
if(x.action==="list"){
 const [shopResult,metricsResult]=await Promise.all([
  root.from("shops").select("id,name,slug,is_active,bw_price,color_price,created_at").order("created_at",{ascending:false}).limit(200),
  root.rpc("printpilot_admin_shop_metrics")
 ]);
 if(shopResult.error)throw shopResult.error;
 if(metricsResult.error)throw metricsResult.error;
 const metrics=new Map((metricsResult.data||[]).map((m:{shop_id:string})=>[m.shop_id,m]));
 const shops=(shopResult.data||[]).map(s=>({
  ...s,metrics:metrics.get(s.id)||{orders_7d:0,waiting_orders:0,printing_orders:0,cleanup_pending:0,verified_revenue_7d:0,last_order_at:null}
 }));
 const overview=shops.reduce((v,s)=>{
  v.total_shops++;if(s.is_active)v.active_shops++;
  v.orders_7d+=Number(s.metrics.orders_7d)||0;
  v.waiting_orders+=Number(s.metrics.waiting_orders)||0;
  v.printing_orders+=Number(s.metrics.printing_orders)||0;
  v.cleanup_pending+=Number(s.metrics.cleanup_pending)||0;
  v.verified_revenue_7d+=Number(s.metrics.verified_revenue_7d)||0;
  return v;
 },{total_shops:0,active_shops:0,orders_7d:0,waiting_orders:0,printing_orders:0,cleanup_pending:0,verified_revenue_7d:0});
 return json({shops,overview});
}
if(x.action==="set_active"){
const shopId=String(x.id||"");
if(!/^[a-f0-9-]{36}$/i.test(shopId))return json({error:"Invalid shop ID"},400);
const {error}=await root.from("shops").update({is_active:x.active===true}).eq("id",shopId);if(error)throw error;return json({ok:true})}
if(x.action!=="invite")return json({error:"Unknown action"},400);
const email=String(x.email||"").trim().toLowerCase(),name=String(x.name||"").trim();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||name.length<2||name.length>80)return json({error:"Valid shop name and email required"},400);
const bw=Number(x.bw??10),color=Number(x.color??20);
if(!Number.isFinite(bw)||!Number.isFinite(color)||bw<0||color<0||bw>10000||color>10000)return json({error:"Invalid price"},400);
const slug="shop-"+crypto.randomUUID().slice(0,12);
const {data:inv,error:ie}=await root.auth.admin.inviteUserByEmail(email,{redirectTo:String(Deno.env.get("PRINTPILOT_SITE_URL")||"https://pranavxvalluru.github.io/PrintPilot/")});
if(ie)return json({error:"Invitation failed: "+ie.message},409);
if(!inv.user?.id)return json({error:"No invited user returned"},500);
const {data:shop,error:se}=await root.from("shops").insert({owner_id:inv.user.id,name,slug,bw_price:bw,color_price:color,is_active:true}).select("id,slug,name").single();
if(se)return json({error:"Invitation was sent, but shop creation failed. Contact admin; do not re-invite until checked.",detail:se.message},500);
return json({ok:true,shop,invited_email:email});
}catch(e){console.error(e);return json({error:"Operation failed"},500)}
});