import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

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
