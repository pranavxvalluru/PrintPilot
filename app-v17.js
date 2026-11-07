/* PrintPilot V1.7: installable shell and opt-in shop-order browser notifications.
   Supabase Realtime + existing dashboard refresh; no R2 reads or background push server. */
'use strict';
(function(){
 const installButtons=['ppInstallApp','ppInstallLogin','ppAdminInstall']
  .map(id=>document.getElementById(id)).filter(Boolean);
 let deferredInstall=null;
 const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
 const feedback=message=>{
  if(typeof note==='function')note(message);
  else if(typeof ppBanner==='function')ppBanner(message);
 };
 function updateInstallButtons(){
  for(const b of installButtons){
   b.textContent=standalone()?'PrintPilot installed':'Install PrintPilot app';
   b.disabled=standalone();
  }
 }
 window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();deferredInstall=event;updateInstallButtons();
 });
 window.addEventListener('appinstalled',()=>{
  deferredInstall=null;updateInstallButtons();feedback('PrintPilot was installed successfully.');
 });
 async function requestInstall(){
  if(standalone()){feedback('PrintPilot is already running as an installed app.');return}
  if(deferredInstall){
   const prompt=deferredInstall;deferredInstall=null;
   await prompt.prompt();
   const choice=await prompt.userChoice;
   if(choice?.outcome!=='accepted')feedback('You can install PrintPilot later from your browser menu.');
   return;
  }
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent);
  feedback(ios
   ?'On iPhone: open PrintPilot in Safari, tap Share, then Add to Home Screen.'
   :'Use your browser menu → Install app / Add to Home Screen. If unavailable, try Chrome or Edge over HTTPS.');
 }
 for(const b of installButtons)b.addEventListener('click',()=>requestInstall().catch(e=>feedback(e.message)));
 updateInstallButtons();
 if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')){
  navigator.serviceWorker.register('./sw.js',{scope:'./'})
   .catch(e=>console.warn('PrintPilot offline shell could not register:',e.message));
 }

 const alertButton=document.getElementById('ppEnableNotifications');
 let seenShop=null,seenReady=new Set(),realtimeChannel=null,realtimeShop=null;
 let lastNoticeAt=0,sessionOptInShop=null;
 const eligible=j=>['received','verified'].includes(j.dbStatus)
   &&!j.cloudDeleted&&Array.isArray(j.files)&&j.files.some(f=>f.uploadState==='ready');
 const shopVisible=()=>!document.getElementById('shopView').classList.contains('hidden');
 const alertsEnabled=shop=>{
  try{return localStorage.getItem('pp_order_alerts_'+shop)==='1'}
  catch{return sessionOptInShop===shop}
 };
 function updateAlertButton(){
  if(!alertButton)return;
  const enabled=!!cloudShopId&&alertsEnabled(cloudShopId)&&('Notification' in window)
   &&Notification.permission==='granted';
  alertButton.textContent=enabled?'Order alerts enabled':'Enable order alerts';
  alertButton.setAttribute('aria-pressed',String(enabled));
  alertButton.title='Alerts for new orders while PrintPilot is open, including background tabs. No notifications after the app is fully closed.';
 }
 async function notifyNewOrders(count,shop){
  if(!shop||!alertsEnabled(shop)||!('Notification' in window)||Notification.permission!=='granted')return;
  if(Date.now()-lastNoticeAt<10000)return;
  lastNoticeAt=Date.now();
  const title=count===1?'New PrintPilot order':count+' new PrintPilot orders';
  const body='New order'+(count===1?'':'s')+' received at '+String(shopSettings.name||'your shop')+'. Open your print queue.';
  const link=new URL('./?view=shop',location.href).href;
  try{
   const registration='serviceWorker' in navigator?await navigator.serviceWorker.getRegistration('./'):null;
   if(registration&&typeof registration.showNotification==='function'){
    await registration.showNotification(title,{body,icon:'./icons/icon-192.png',
     badge:'./icons/icon-192.png',tag:'printpilot-new-order-'+shop,
     data:{url:link}});
   }else{
    const n=new Notification(title,{body,icon:'./icons/icon-192.png',tag:'printpilot-new-order-'+shop});
    n.onclick=()=>{window.focus();n.close()};
   }
  }catch(e){console.warn('Order notification unavailable:',e.message)}
 }
 const previousSync=syncJobs;
 syncJobs=async function(...args){
  const result=await previousSync.apply(this,args);
  const shop=cloudShopId;
  if(!shop||!shopVisible()){
   if(!shop){seenShop=null;seenReady=new Set()}
   return result;
  }
  const ready=cloudRemoteJobs.filter(eligible);
  if(seenShop!==shop){
   seenShop=shop;seenReady=new Set(ready.map(j=>j.id));updateAlertButton();
   return result; // Never alert on the existing queue when the owner signs in.
  }
  const fresh=ready.filter(j=>!seenReady.has(j.id));
  ready.forEach(j=>seenReady.add(j.id));
  // Ignore stale arrivals from long network outages.
  const recent=fresh.filter(j=>Date.now()-Date.parse(j.createdAt)<10*60*1000);
  if(recent.length)notifyNewOrders(recent.length,shop).catch(console.warn);
  return result;
 };
 async function stopRealtime(){
  if(realtimeChannel&&cloud){
   try{await cloud.removeChannel(realtimeChannel)}catch(e){console.warn(e)}
  }
  realtimeChannel=null;realtimeShop=null;
 }
 async function startRealtime(){
  const shop=cloudShopId;
  if(!shop||!cloud||!shopVisible()){await stopRealtime();return}
  if(realtimeShop===shop&&realtimeChannel)return;
  await stopRealtime();
  realtimeShop=shop;
  realtimeChannel=cloud.channel('printpilot-ready-'+shop)
   .on('postgres_changes',{
    event:'UPDATE',schema:'public',table:'orders',filter:'shop_id=eq.'+shop
   },payload=>{
    const o=payload.new;
    if(o&&o.upload_state==='ready'&&['received','verified'].includes(o.status)){
     syncJobs().catch(e=>console.warn('PrintPilot live order refresh:',e.message));
    }
   }).subscribe(status=>{
    if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){
     console.warn('PrintPilot live updates unavailable; visible-tab polling remains active.');
    }
   });
 }
 const previousAfterAuth=ppAfterAuth;
 ppAfterAuth=async function(...args){
  await previousAfterAuth.apply(this,args);
  updateAlertButton();
  if(cloudShopId&&shopVisible())await startRealtime();
  else await stopRealtime();
 };
 alertButton?.addEventListener('click',async()=>{
  if(!cloudShopId){feedback('Sign in to your shop first.');return}
  if(!window.isSecureContext||!('Notification' in window)){
   feedback('This browser does not support order alerts. On iPhone, install the app and open it from your Home Screen.');return;
  }
  try{
   const permission=await Notification.requestPermission();
   if(permission==='granted'){
    sessionOptInShop=cloudShopId;
    try{localStorage.setItem('pp_order_alerts_'+cloudShopId,'1')}catch{}
    feedback('Order alerts enabled while PrintPilot is open. You will not receive alerts after closing the app.');
    await startRealtime();
   }else feedback('Notifications are blocked. Enable them for PrintPilot in your browser settings.');
  }catch(e){feedback('Could not enable notifications: '+e.message)}
  updateAlertButton();
 });
 for(const id of ['logoutOwner','ppAdminLogout']){
  document.getElementById(id)?.addEventListener('click',()=>{
   stopRealtime().catch(console.warn);seenShop=null;seenReady=new Set();
  });
 }
 window.addEventListener('pagehide',()=>{stopRealtime().catch(()=>{})});
 updateAlertButton();
})();
