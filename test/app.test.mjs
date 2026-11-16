// Browser test of the web app with the GitHub API simulated. Run after test/e2e.mjs (uses its site output).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeSite } from '../src/site.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(here, 'out', 'site');
writeSite({ checksFile: path.join(here, 'out', 'checks.json'), siteDir: SITE, statusFrom: path.join(SITE, 'checks-status.json'), repo: 'WaleCalfos-dp/atom-parity' });
const st = JSON.parse(fs.readFileSync(path.join(SITE, 'checks-status.json'), 'utf8'));
// give the first check some history so the trend line draws
st.entries[0].history = [{ at: '2026-11-10', score: 41 }, { at: '2026-11-12', score: 52 }, { at: '2026-11-14', score: 48 }, { at: st.entries[0].ranAt, score: st.entries[0].score }];
st.entries[0].previousScore = 48;
fs.writeFileSync(path.join(SITE, 'checks-status.json'), JSON.stringify(st));

let statusOverride = null;
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('checks-status.json') && statusOverride) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(statusOverride)); }
  let f = path.join(SITE, p.replace(/^\/atom-parity/, ''));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const type = { '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(f)] ?? 'text/html';
  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/atom-parity/`;

const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/usr/bin/google-chrome' }));
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });

// A stale failed run saved by the old page must not appear
await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('ap.runs', JSON.stringify([{ req: 'old12345', label: 'New check', startedAt: Date.now() - 60000, state: 'failed', step: "GitHub didn't start the check" }])); sessionStorage.setItem('seeded', '1'); } });

const gh = { dispatched: [], req: null, polls: 0 };
await page.route('https://api.github.com/**', async (route) => {
  const u = new URL(route.request().url());
  const authz = route.request().headers().authorization;
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname.endsWith('/actions/workflows/atom-parity.yml') && route.request().method() === 'GET') return authz === 'Bearer good-key' ? json({ id: 1 }) : json({ message: 'Bad credentials' }, 401);
  if (u.pathname.endsWith('/dispatches')) { const b = JSON.parse(route.request().postData()); gh.dispatched.push(b); gh.req = b.inputs.request_id; gh.polls = 0; return route.fulfill({ status: 204 }); }
  if (u.pathname.endsWith('/runs')) return json({ workflow_runs: gh.req ? [{ id: 77, status: gh.polls < 2 ? 'queued' : 'in_progress', created_at: new Date().toISOString(), display_title: gh.polls < 2 ? 'Atom parity' : `Buttons [${gh.req}]` }] : [] });
  if (u.pathname.endsWith('/runs/77')) { gh.polls++; return json({ id: 77, html_url: 'https://github.com/x/runs/77', status: gh.polls < 2 ? 'queued' : gh.polls > 3 ? 'completed' : 'in_progress', conclusion: gh.polls > 3 ? 'success' : null }); }
  if (u.pathname.endsWith('/runs/77/jobs')) return json({ jobs: [{ steps: [{ name: 'Install the browser', status: 'completed' }, { name: 'Compare Figma with Storybook', status: 'in_progress' }] }] });
  return json({}, 404);
});

await page.goto(BASE);
await page.waitForSelector('.card');
await page.waitForTimeout(500);
assert.equal(await page.locator('.run').count(), 0, 'stale failed run from the old page is not shown');
assert.ok((await page.inputValue('#sb')).includes('/atom-ui-mobile/'), 'Storybook link prefilled from saved checks');
assert.match(await page.textContent('#ovTitle'), /parity with Figma/);
await page.screenshot({ path: '/tmp/app-1.png', fullPage: true });

// Run without a key → connect dialog
await page.fill('#figma', 'https://www.figma.com/design/nKc4ep7mNdD5IqFRhNRNlW/Component-Library?node-id=450-396167');
await page.fill('#name', 'Buttons');
await page.click('#runBtn');
await page.waitForSelector('dialog[open]');
await page.screenshot({ path: '/tmp/app-dialog.png' });
await page.fill('#key', 'nope'); await page.click('#saveKey');
await page.waitForFunction(() => /recognise/.test(document.getElementById('keyErr').textContent));
await page.fill('#key', 'good-key'); await page.click('#saveKey');
// Connecting continues the run the user asked for
await page.waitForFunction(() => !document.querySelector('dialog[open]'));
await page.waitForSelector('.run');
assert.match(await page.textContent('#connLabel'), /Connected/);
assert.equal(gh.dispatched.at(-1).inputs.name, 'Buttons');
await page.waitForFunction(() => /Queued/.test(document.getElementById('runs').textContent), null, { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.steps li.now') && /Comparing/.test(document.querySelector('.steps li.now').textContent), null, { timeout: 30000 });
await page.screenshot({ path: '/tmp/app-2.png' });
statusOverride = { ...st, generatedAt: new Date(Date.now() + 60000).toISOString() };
await page.waitForFunction(() => /Report ready/.test(document.getElementById('runs').textContent), null, { timeout: 30000 });

// Dismiss works
await page.click('.run [data-dismiss]');
assert.equal(await page.locator('.run').count(), 0, 'dismissed');

// Validation
await page.fill('#figma', 'https://example.com/x'); await page.click('#runBtn');
assert.match(await page.textContent('#formErr'), /Figma design link/);
await page.fill('#figma', '');

// Menu → remove → confirm
await page.click('.card [data-act="menu"]');
await page.waitForSelector('.menu-list');
await page.screenshot({ path: '/tmp/app-menu.png' });
await page.click('.menu-list [data-act="remove"]');
await page.waitForSelector('.confirm');
await page.click('.confirm [data-act="remove-yes"]');
await page.waitForFunction(() => /Removing/.test(document.getElementById('runs').textContent));
assert.ok(gh.dispatched.at(-1).inputs.remove_id, 'remove dispatched');

// Report
const firstId = st.entries.find((e) => e.ok).id;
await page.goto(BASE + firstId + '/');
await page.waitForSelector('.comp');
await page.screenshot({ path: '/tmp/report-1.png', fullPage: false });
await page.click('.comp summary');
await page.waitForSelector('.body .grp');
await page.screenshot({ path: '/tmp/report-2.png' });
// Accessibility section: issues with WCAG references and a Figma-vs-code verdict
assert.ok(await page.locator('#accessibility .issue').count() > 0, 'accessibility issues listed');
assert.match(await page.textContent('#accessibility'), /WCAG 1\.4\.3/);
await page.locator('#accessibility').scrollIntoViewIfNeeded();
await page.screenshot({ path: '/tmp/report-a11y.png', fullPage: false });
await page.goto(BASE + firstId + '/#accessibility');
await page.waitForSelector('.issue');
await page.screenshot({ path: '/tmp/report-a11y-full.png', fullPage: true });
assert.equal(await page.locator('#tabs a[aria-current=true]').count(), 1, 'section nav marks the current section');
// The tool's own pages must pass WCAG 2.2 AA
const AXE = fs.readFileSync(path.join(here, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
async function axeCheck(label) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, t: x.nodes.map((nd) => nd.target.join(' ') + ' :: ' + (nd.failureSummary.match(/contrast of [^)]+\)/) || [''])[0]).join('\n'), s: x.nodes[0].failureSummary.slice(0, 200) })));
  if (v.length) console.log(label, JSON.stringify(v.map((x) => [x.id, x.n, x.t, x.s.slice(40, 190)]), null, 1));
  assert.deepEqual(v, [], label + ' has accessibility violations: ' + JSON.stringify(v, null, 1));
}
await axeCheck('report');
await page.emulateMedia({ colorScheme: 'dark' });
await page.reload(); await page.waitForSelector('.issue');
await page.screenshot({ path: '/tmp/report-dark.png', fullPage: false });
await axeCheck('report (dark)');
await page.goto(BASE); await page.waitForSelector('.card');
await page.waitForTimeout(1600);
await page.screenshot({ path: '/tmp/app-dark.png', fullPage: true });
await axeCheck('home (dark)');
await page.emulateMedia({ colorScheme: 'light' });
await page.reload(); await page.waitForSelector('.card'); await page.waitForTimeout(1600);
await axeCheck('home');

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE);
await page.waitForSelector('.card');
await page.screenshot({ path: '/tmp/app-mobile.png', fullPage: true });

assert.deepEqual(errors, [], 'no page errors');
await browser.close(); server.close();
console.log('✓ web app test passed');
