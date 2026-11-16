// Browser test of the web app with the GitHub API simulated. Run after test/e2e.mjs (uses its site output).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appHtml } from '../src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(here, 'out', 'site');
fs.writeFileSync(path.join(SITE, 'index.html'), appHtml({ repo: 'WaleCalfos-dp/atom-parity' }));
let statusOverride = null;
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('checks-status.json') && statusOverride) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(statusOverride)); }
  let f = path.join(SITE, p.replace(/^\/atom-parity/, ''));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.json') ? 'application/json' : f.endsWith('.png') ? 'image/png' : 'text/html' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/atom-parity/`;

const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/usr/bin/google-chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));

// Simulated GitHub
const gh = { dispatched: [], req: null, polls: 0 };
await page.route('https://api.github.com/**', async (route) => {
  const u = new URL(route.request().url());
  const authz = route.request().headers().authorization;
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname.endsWith('/actions/workflows/atom-parity.yml') && route.request().method() === 'GET') return authz === 'Bearer good-key' ? json({ id: 1 }) : json({ message: 'Bad credentials' }, 401);
  if (u.pathname.endsWith('/dispatches')) { const b = JSON.parse(route.request().postData()); gh.dispatched.push(b); gh.req = b.inputs.request_id; return route.fulfill({ status: 204 }); }
  if (u.pathname.endsWith('/runs')) return json({ workflow_runs: gh.req ? [{ id: 77, display_title: `Buttons [${gh.req}]` }] : [] });
  if (u.pathname.endsWith('/runs/77')) { gh.polls++; return json({ id: 77, html_url: 'https://github.com/x/runs/77', status: gh.polls > 2 ? 'completed' : 'in_progress', conclusion: gh.polls > 2 ? 'success' : null }); }
  if (u.pathname.endsWith('/runs/77/jobs')) return json({ jobs: [{ steps: [{ name: 'Install the browser', status: 'completed' }, { name: 'Compare Figma with Storybook', status: 'in_progress' }] }] });
  return json({}, 404);
});

await page.goto(BASE);
await page.waitForSelector('.item');
await page.screenshot({ path: '/tmp/app-1.png' });
const names = await page.$$eval('.item .name', (els) => els.map((e) => e.textContent));
assert.ok(names.length >= 1, 'checks listed');

// Running without a key opens the key panel
await page.fill('#figma', 'https://www.figma.com/design/nKc4ep7mNdD5IqFRhNRNlW/Component-Library?node-id=450-396167');
await page.fill('#sb', 'https://dp-atom-ui-test.dragonpass.com.cn/atom-ui-mobile/component?path=/');
await page.fill('#name', 'Buttons');
await page.click('#runBtn');
assert.equal(await page.isVisible('#keyPanel'), true, 'asks for a key first');

// Bad key, then good key
await page.fill('#key', 'nope'); await page.click('#saveKey');
await page.waitForFunction(() => document.getElementById('keyErr').textContent.length > 0);
assert.match(await page.textContent('#keyErr'), /doesn't recognise/);
await page.fill('#key', 'good-key'); await page.click('#saveKey');
await page.waitForFunction(() => document.getElementById('keyPanel').hidden);
assert.match(await page.textContent('#keyLabel'), /saved/);

// Validation
await page.fill('#figma', 'https://example.com/x'); await page.click('#runBtn');
assert.match(await page.textContent('#formErr'), /Figma design link/);
await page.fill('#figma', 'https://www.figma.com/design/nKc4ep7mNdD5IqFRhNRNlW/Component-Library?node-id=450-396167');

// Run → progress → done
await page.click('#runBtn');
await page.waitForSelector('.run');
assert.equal(gh.dispatched.at(-1).inputs.figma_url.includes('figma.com'), true);
assert.equal(gh.dispatched.at(-1).inputs.name, 'Buttons');
await page.waitForFunction(() => /Comparing/.test(document.getElementById('runs').textContent), null, { timeout: 20000 });
await page.screenshot({ path: '/tmp/app-2.png' });
// The site publishes: status file now newer than the run start
const st = JSON.parse(fs.readFileSync(path.join(SITE, 'checks-status.json'), 'utf8'));
statusOverride = { ...st, generatedAt: new Date(Date.now() + 60000).toISOString() };
await page.waitForFunction(() => /Report ready/.test(document.getElementById('runs').textContent), null, { timeout: 30000 });
assert.equal(await page.inputValue('#figma'), '', 'form cleared after starting');

// Remove asks for confirmation inline, then dispatches remove_id
await page.click('.item [data-act="remove"]');
await page.waitForSelector('.confirm');
await page.screenshot({ path: '/tmp/app-3.png' });
await page.click('.confirm [data-act="remove-yes"]');
await page.waitForFunction(() => /Removing/.test(document.getElementById('runs').textContent));
assert.ok(gh.dispatched.at(-1).inputs.remove_id, 'remove dispatched');

// Report page
const firstId = st.entries.find((e) => e.ok).id;
await page.goto(BASE + firstId + '/');
await page.waitForSelector('.comp');
await page.screenshot({ path: '/tmp/report-1.png' });
await page.click('.comp summary');
await page.waitForSelector('.body .grp');
await page.screenshot({ path: '/tmp/report-2.png', fullPage: false });
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE);
await page.waitForSelector('.item');
await page.screenshot({ path: '/tmp/app-mobile.png' });

assert.deepEqual(errors, [], 'no page errors');
await browser.close(); server.close();
console.log('✓ web app test passed');
