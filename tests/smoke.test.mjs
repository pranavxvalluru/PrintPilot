import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, runInNewContext } from 'node:vm';
import { inflateSync } from 'node:zlib';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const favicon = readFileSync(new URL('../favicon.svg', import.meta.url), 'utf8');

test('all inline application scripts parse as JavaScript', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 7, 'expected application scripts');
  scripts.forEach(([_, code], i) => assert.doesNotThrow(() => new Script(code, { filename: 'inline-' + i + '.js' })));
});

test('minimal launch has one animated mark and no loading bar or decoration', () => {
  const intro = html.match(/<div id="ppIntro"[\s\S]*?(?=\n<script>)/)?.[0];
  assert.ok(intro, 'intro must exist');
  assert.match(intro, /pp-launch-mark/);
  assert.match(intro, /Print<span>Pilot<\/span>/);
  for (const forbidden of ['pp-meter', 'pp-orbit', 'pp-sheet', 'pp-pillars', 'pp-atmosphere', 'pp-bottom']) {
    assert.ok(!intro.includes(forbidden), forbidden + ' should not appear in intro');
  }
  assert.match(html, /timeout=setTimeout\(dismiss,1900\)/);
  assert.match(html, /customer\|\|reduceMotion\|\|\(seen&&!preview\)/);
});

test('brand icon is available and consistent', () => {
  assert.match(html, /href="\.\/favicon\.svg"/);
  assert.match(favicon, /viewBox="0 0 100 100"/);
  assert.match(favicon, /M32 76V25H55C69 25 78 32 78 44S69 63 55 63H47/);
});

test('existing core order and secure print flows remain present', () => {
  for (const name of ['submitOrder=async function()', 'openPrint=async function(id)', 'beginWindow(id)', 'printpilot-r2-file', 'printpilot-r2-gateway', 'ppOrderAction']) {
    assert.ok(html.includes(name), 'missing core integration ' + name);
  }
});

test('hidden shop tabs do not poll continuously and refresh on return', () => {
  assert.match(html, /document\.visibilityState!=='hidden'/);
  assert.match(html, /document\.addEventListener\('visibilitychange'/);
});

test('shop branding follows the signed-in shop rather than a placeholder', () => {
  assert.match(html, /document\.querySelector\('\.customer-top-actions \.pill-live'\)/);
  assert.ok(!html.includes("if(x.textContent.includes('Print Studio'))"), 'stale placeholder-only brand update');
  assert.match(html, /shopSettings=\{\.\.\.shopSettings,name:data\.name/);
  assert.match(html, /renderShopBrand\(\);updatePrice\(\)/);
});

test('shop owners can edit only allowed shop profile fields', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261105_shop_owner_profile_permissions.sql', import.meta.url), 'utf8');
  assert.match(sql, /grant update \(name, bw_price, color_price\)/i);
  assert.match(sql, /on table public\.shops\s+to authenticated;/i);
  assert.ok(!/grant update\s+on table/i.test(sql), 'avoid granting update on every column');
});

test('authenticated shop identity updates sidebar and profile without duplicate top-right current shop', () => {
  for (const id of ['ppSidebarShopName', 'ppSidebarProfileName', 'ppSidebarAvatar']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing ' + id);
  }
  const start = html.indexOf('function renderShopBrand(){');
  const end = html.indexOf('async function saveShopSettings()', start);
  assert.ok(start >= 0 && end > start, 'brand renderer must be present');
  const elements = new Map(
    ['ppSidebarShopName','ppSidebarProfileName','ppSidebarAvatar','shopIdentity','payShopName','customerPayQr','settingsQrPreview']
      .map(id => [id, { textContent:'', innerHTML:'', title:'', setAttribute(key,value){this[key]=value} }])
  );
  const badge = { innerHTML:'' };
  const context = {
    shopSettings:{name:'Gopal Xerox',qr:''},
    document:{
      getElementById:id=>elements.get(id),
      querySelector:selector=>selector==='.customer-top-actions .pill-live'?badge:null
    },
    $:selector=>elements.get(selector.slice(1)),
    esc:value=>String(value)
  };
  const script = html.slice(start,end) + '\nrenderShopBrand();';
  runInNewContext(script,context);
  for (const id of ['ppSidebarShopName','ppSidebarProfileName','shopIdentity','payShopName']) {
    assert.equal(elements.get(id).textContent,'Gopal Xerox',id);
  }
  assert.equal(elements.get('ppSidebarAvatar').textContent,'GX');
  assert.match(badge.innerHTML,/Gopal Xerox/);

  context.shopSettings.name='Lakshmi Print Works';
  runInNewContext(script,context);
  assert.equal(elements.get('ppSidebarShopName').textContent,'Lakshmi Print Works');
  assert.equal(elements.get('ppSidebarAvatar').textContent,'LP');
  assert.ok(!html.includes('<strong>Print Studio</strong>'), 'do not hardcode the previous shop name');
  assert.ok(!html.includes('CURRENT SHOP'), 'remove redundant current shop header');
  assert.ok(!html.includes('id="ppTopShopName"'), 'remove top-right current shop label');
  assert.ok(!html.includes('id="ppTopShopAvatar"'), 'remove top-right current shop avatar');
  assert.ok(html.includes('id="topQr"'), 'retain shop QR action');
});

const orderApi = readFileSync(new URL('../supabase/functions/printpilot-orders/index.ts', import.meta.url), 'utf8');
const printWindow = readFileSync(new URL('../supabase/functions/printpilot-print-window/index.ts', import.meta.url), 'utf8');
const fallback = readFileSync(new URL('../supabase/functions/printpilot-r2-file/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261105_printpilot_v16_orders_reports.sql', import.meta.url), 'utf8');

test('multiple files are accepted as one order, with bounded storage and verified uploads', () => {
  assert.match(orderApi, /Array\.isArray\(body\.files\)/);
  assert.match(orderApi, /incoming\.length>5/);
  assert.match(orderApi, /dailyCount\|\|0\)>=200/);
  assert.match(orderApi, /totalBytes>12\*1024\*1024/);
  assert.match(orderApi, /totalPages>500/);
  assert.match(orderApi, /prepared\.push\(/);
  assert.match(orderApi, /for\(const f of prepared\)/);
  assert.match(orderApi, /method:"PUT"/);
  assert.match(orderApi, /method:"HEAD"/);
  assert.match(orderApi, /method:"DELETE"/);
  assert.match(orderApi, /upload_state:"ready"/);
  assert.match(html, /files\.push\(\{name:file\.name/);
  assert.match(html, /5 MB each \/ 12 MB total/);
  assert.ok(!html.includes('For this first cloud test, select exactly one document.'));
});

test('one-hour abandoned order cleanup is server-driven, idempotent and retries failed deletions', () => {
  assert.match(printWindow, /Date\.now\(\)-3600000/);
  assert.match(printWindow, /print_window_started_at",null/);
  assert.match(printWindow, /abandoned_1h_pending/);
  assert.match(printWindow, /await removeDocuments\(o\.id\)/);
  assert.match(printWindow, /cloud_deleted_at:now,completion_source:"abandoned_1h"/);
  assert.match(printWindow, /"received","verified","cancelled"/);
  assert.match(migration, /delete_after set default \(now\(\) \+ interval '1 hour'\)/);
  assert.ok(!printWindow.includes('Date.now()-86400000'));
});

test('customer tracking is token protected and reads only order metadata', () => {
  assert.match(migration, /tracking_token_sha256/);
  assert.match(orderApi, /if\(action==="track"\)/);
  assert.match(orderApi, /tracking_token_sha256",await sha\(token\)/);
  assert.match(orderApi, /tracking_token:trackingToken/);
  assert.match(html, /ppShowTracking\(data\)/);
  assert.match(html, /ppCheckTracking\(ppTrackingCode,'ppTrackState'\)/);
  assert.ok(!orderApi.includes('ListObjects'), 'tracking must not list R2 objects');
  const track = orderApi.split('if(action==="track"){')[1].split('if(action==="submit"){')[0];
  assert.ok(!/storage_path|WORKER|documents|original_name/.test(track), 'tracking must not expose documents');
});

test('daily reports use authenticated owner-scoped SQL, never R2', () => {
  assert.match(migration, /security invoker/);
  assert.match(migration, /s\.owner_id=\(select auth\.uid\(\)\)/);
  assert.match(migration, /printpilot_shop_revenue_daily/);
  assert.match(migration, /revoke all on function public\.printpilot_daily_sales\(integer\) from public, anon/);
  assert.match(html, /cloud\.rpc\('printpilot_daily_sales'/);
  assert.match(html, /printpilot-daily-sales\.csv/);
  assert.match(html, /id="ppDailyReports"/);
});

test('customer portal is compact and explains cloud deletion without misleading claims', () => {
  assert.match(html, /pp-customer-clean/);
  assert.match(html, /stored in the cloud and automatically deleted/);
  assert.match(html, /If printing never starts, files are automatically deleted after one hour/);
  assert.match(html, /after one hour for orders where printing never starts/);
  assert.ok(!html.includes('End-to-end encryption and unattended expiry cleanup are not yet implemented'));
});

test('multi-file R2 fallback resolves exactly the selected authorized object', () => {
  assert.match(fallback, /requestedKey=String\(b\.key\|\|""\)/);
  assert.match(fallback, /query=query\.eq\("storage_path",requestedKey\)/);
  assert.match(fallback, /matches\?\.length===1/);
  assert.match(html, /body:JSON\.stringify\(\{order_id:id,key:f\.remotePath\}\)/);
});

test('multi-file printing opens only one tab per user click', () => {
  assert.match(html, /openPrint=async function\(id,fileIndex=0\)/);
  assert.match(html, /filter\(\(_,index\)=>index===fileIndex\)/);
  assert.match(html, /ppRenderDetailsBeforeMulti/);
  assert.match(html, /button\.dataset\.ppFileIndex/);
  assert.match(html, /openPrint\(id,index\)/);
});

const appV17 = readFileSync(new URL('../app-v17.js', import.meta.url),'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url),'utf8');
const manifestV17 = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url),'utf8'));
const qrVendor = readFileSync(new URL('../vendor/qrcode.js', import.meta.url),'utf8');
const adminApi = readFileSync(new URL('../supabase/functions/printpilot-admin/index.ts', import.meta.url),'utf8');
const adminMigration = readFileSync(new URL('../supabase/migrations/20261107_printpilot_v17_admin_metrics_realtime.sql', import.meta.url),'utf8');

test('PWA has valid app manifest, icons and public-only cache', () => {
  assert.doesNotThrow(()=>new Script(appV17));
  assert.doesNotThrow(()=>new Script(serviceWorker));
  assert.equal(manifestV17.start_url,'./?view=shop');
  assert.equal(manifestV17.scope,'./');
  assert.equal(manifestV17.display,'standalone');
  assert.equal(manifestV17.icons.length,2);
  assert.match(html,/rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html,/rel="apple-touch-icon" href="\.\/icons\/icon-180\.png"/);
  assert.match(html,/src="\.\/app-v17\.js"/);
  assert.match(appV17,/navigator\.serviceWorker\.register\('\.\/sw\.js'/);
  assert.match(serviceWorker,/req\.method!=='GET'\|\|new URL\(req\.url\)\.origin!==self\.location\.origin/);
  assert.match(serviceWorker,/if\(!files\.includes\(url\.href\)\)return/);
  assert.ok(!serviceWorker.includes('supabase.co'),'service worker must not cache Supabase');
  assert.ok(!serviceWorker.includes('workers.dev'),'service worker must not cache R2');
  assert.match(serviceWorker,/notificationclick/);
});

test('PWA icon PNGs are valid, correctly sized, and decompress', () => {
  for(const size of [180,192,512]){
    const png=readFileSync(new URL('../icons/icon-'+size+'.png',import.meta.url));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16),size);
    assert.equal(png.readUInt32BE(20),size);
    let pos=8,idat=[];
    while(pos<png.length){
      const len=png.readUInt32BE(pos),type=png.subarray(pos+4,pos+8).toString('ascii');
      if(type==='IDAT')idat.push(png.subarray(pos+8,pos+8+len));
      pos+=12+len;
      if(type==='IEND')break;
    }
    const pixels=inflateSync(Buffer.concat(idat));
    assert.equal(pixels.length,size*(1+Math.ceil(size/4)));
  }
});

test('Super Admin metrics are service-role-only and contain no documents', () => {
  assert.match(adminApi,/root\.auth\.getUser\(bearer\.slice\(7\)\)/);
  assert.match(adminApi,/root\.from\("platform_admins"\)/);
  assert.match(adminApi,/root\.rpc\("printpilot_admin_shop_metrics"\)/);
  assert.match(adminApi,/overview/);
  assert.match(adminMigration,/security invoker/);
  assert.match(adminMigration,/revoke all on function public\.printpilot_admin_shop_metrics\(\) from public, anon, authenticated/);
  assert.match(adminMigration,/grant execute on function public\.printpilot_admin_shop_metrics\(\) to service_role/);
  assert.match(adminMigration,/alter publication supabase_realtime add table public\.orders/);
  assert.match(html,/id="ppAdminStatRevenue"/);
  assert.match(html,/id="ppAdminStatusFilter"/);
  assert.match(html,/function ppAdminRenderRows\(\)/);
  assert.ok(!/storage_path|original_name|customer_name/.test(adminApi),'admin API must not access customer files or names');
});

test('Order notifications require explicit permission and owner-filtered live updates', () => {
  assert.match(appV17,/alertButton\?\.addEventListener\('click',async\(\)=>/);
  assert.match(appV17,/Notification\.requestPermission\(\)/);
  assert.match(appV17,/cloud\.channel\('printpilot-ready-'\+shop\)/);
  assert.match(appV17,/event:'UPDATE',schema:'public',table:'orders',filter:'shop_id=eq\.'\+shop/);
  assert.match(appV17,/o\.upload_state==='ready'/);
  assert.match(appV17,/seenShop=shop;seenReady=new Set\(ready\.map\(j=>j\.id\)\)/);
  assert.match(appV17,/shopVisible\(\)/);
  assert.match(appV17,/registration\.showNotification/);
  assert.ok(!appV17.includes('ListObjects'));
  assert.ok(!appV17.includes('printpilot-r2-gateway'));
});

test('Shop QR poster uses local MIT QR library and downloads A4 PNG without R2', () => {
  assert.doesNotThrow(()=>new Script(qrVendor));
  const context={};
  runInNewContext(qrVendor,context);
  assert.equal(typeof context.qrcode,'function');
  const q=context.qrcode(0,'M');
  q.addData('https://pranavxvalluru.github.io/PrintPilot/?view=customer&shop=gopal-xerox');
  q.make();
  assert.ok(q.getModuleCount()>=21);
  assert.match(q.createSvgTag({cellSize:7,margin:28}),/<svg/);
  assert.match(html,/function ppDownloadPoster\(\)/);
  assert.match(html,/qr\.isDark\(y,x\)/);
  assert.match(html,/canvas\.toBlob/);
  assert.match(html,/id="ppDownloadPoster"/);
  assert.match(html,/vendor\/qrcode\.js/);
  assert.ok(!html.includes('api.qrserver.com'),'QR poster must not rely on external QR service');
});

test('live notification controller primes existing orders, alerts once for new ready orders, and respects permission', async () => {
  const notifications=[];
  const button={addEventListener(){},setAttribute(){},textContent:'',title:''};
  const NotificationMock=class {
    static permission='granted';
    constructor(title,opts){notifications.push({title,opts})}
    close(){}
  };
  const context={
    window:{matchMedia:()=>({matches:false}),navigator:{standalone:false},addEventListener(){},
      Notification:NotificationMock,isSecureContext:true},
    document:{getElementById:id=>id==='shopView'?{classList:{contains:()=>false}}:id==='ppEnableNotifications'?button:null},
    location:{protocol:'http:',hostname:'localhost',href:'http://localhost/PrintPilot/'},
    cloudShopId:'shop-one',cloudRemoteJobs:[],cloud:null,
    shopSettings:{name:'Gopal Xerox'},
    syncJobs:async()=>{},ppAfterAuth:async()=>{},
    localStorage:{getItem:()=> '1',setItem(){}},
    note(){},console,URL,Notification:NotificationMock,Date,
  };
  context.navigator=context.window.navigator;
  const ready=id=>({id,dbStatus:'received',cloudDeleted:false,createdAt:new Date().toISOString(),files:[{uploadState:'ready'}]});
  context.cloudRemoteJobs=[ready('already-present')];
  runInNewContext(appV17,context);
  await context.syncJobs();
  assert.equal(notifications.length,0,'do not notify on initial login');
  context.cloudRemoteJobs=[ready('new-order'),ready('already-present')];
  await context.syncJobs();
  assert.equal(notifications.length,1,'notify for newly ready order');
  assert.match(notifications[0].opts.body,/Gopal Xerox/);
  await context.syncJobs();
  assert.equal(notifications.length,1,'do not duplicate notification on polling');
  NotificationMock.permission='denied';
  context.cloudRemoteJobs=[ready('another-order'),...context.cloudRemoteJobs];
  await context.syncJobs();
  assert.equal(notifications.length,1,'respect browser permission');
});
