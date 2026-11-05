import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, runInNewContext } from 'node:vm';

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

test('authenticated shop identity updates sidebar, header, profile and avatars', () => {
  for (const id of ['ppSidebarShopName', 'ppSidebarProfileName', 'ppTopShopName', 'ppSidebarAvatar', 'ppTopShopAvatar']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing ' + id);
  }
  const start = html.indexOf('function renderShopBrand(){');
  const end = html.indexOf('async function saveShopSettings()', start);
  assert.ok(start >= 0 && end > start, 'brand renderer must be present');
  const elements = new Map(
    ['ppSidebarShopName','ppSidebarProfileName','ppTopShopName','ppSidebarAvatar','ppTopShopAvatar','shopIdentity','payShopName','customerPayQr','settingsQrPreview']
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
  for (const id of ['ppSidebarShopName','ppSidebarProfileName','ppTopShopName','shopIdentity','payShopName']) {
    assert.equal(elements.get(id).textContent,'Gopal Xerox',id);
  }
  assert.equal(elements.get('ppSidebarAvatar').textContent,'GX');
  assert.equal(elements.get('ppTopShopAvatar').textContent,'GX');
  assert.match(badge.innerHTML,/Gopal Xerox/);

  context.shopSettings.name='Lakshmi Print Works';
  runInNewContext(script,context);
  assert.equal(elements.get('ppTopShopName').textContent,'Lakshmi Print Works');
  assert.equal(elements.get('ppTopShopAvatar').textContent,'LP');
  assert.ok(!html.includes('<strong>Print Studio</strong>'), 'do not hardcode the previous shop name');
});

const orderApi = readFileSync(new URL('../supabase/functions/printpilot-orders/index.ts', import.meta.url), 'utf8');
const printWindow = readFileSync(new URL('../supabase/functions/printpilot-print-window/index.ts', import.meta.url), 'utf8');
const fallback = readFileSync(new URL('../supabase/functions/printpilot-r2-file/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261105_printpilot_v16_orders_reports.sql', import.meta.url), 'utf8');

test('multiple files are accepted as one order, with bounded storage and verified uploads', () => {
  assert.match(orderApi, /Array\.isArray\(body\.files\)/);
  assert.match(orderApi, /incoming\.length>5/);
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
