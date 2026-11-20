// The in-page AA checks (src/page/aa.js) against a fixture with known problems.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { aaPage } from '../src/page/aa.js';
import { fullAA } from '../src/storybook.js';
import { aaQuickChecks, aaFullChecks, a11ySummary } from '../src/a11y.js';
import { Checks } from '../src/compare.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 375, height: 812 } });
await page.goto('file://' + path.join(here, 'fixtures/aa.html'));

const q = await page.evaluate(aaPage, { cmd: 'quick' });
const fieldFails = q.nonText.filter((x) => x.kind === 'field');
assert.equal(fieldFails.length, 1, 'only the pale-bordered field fails 1.4.11');
assert.ok(fieldFails[0].ratio < 3);
const iconFails = q.nonText.filter((x) => x.kind === 'icon');
assert.equal(iconFails.length, 1, 'only the pale icon fails 1.4.11');
assert.equal(q.labels.length, 1, 'only "Send" announced as "Submit form" fails 2.5.3');
assert.equal(q.labels[0].visible, 'Send');

const full = await fullAA(page);
const items = full.kbd.items;
assert.equal(full.kbd.trapped, false);
assert.ok(!items.some((i) => !i.pointerOnly && !i.reached && i.target !== 'button'), 'controls taken out of the tab order on purpose (tabindex=-1) are not flagged');
assert.ok(items.find((i) => i.text === 'Open details' && i.pointerOnly && !i.reached), 'clickable div is not reachable');
assert.equal(items.find((i) => i.text === 'Plain').visible, false, 'button with outline:none shows no focus');
assert.equal(items.find((i) => i.text === 'Send').visible, true, 'default focus ring counts');
assert.ok(items.find((i) => i.text === 'Hidden').obscured, 'covered button is obscured');
assert.ok(full.layout.text.clippedCount >= 1, '200% text clips the fixed-height box');
assert.ok(full.layout.spacing.clippedCount >= 1, 'text spacing clips the fixed-height box');
assert.ok(full.layout.reflow.overflow && full.layout.reflow.overflow.width >= 420, 'the 420px block needs sideways scrolling at 320px');
assert.equal(page.viewportSize().width, 375, 'viewport restored');
assert.equal(await page.evaluate(() => document.querySelectorAll('[data-ap-sentinel],[data-ap-k],#ap-spacing').length), 0, 'page cleaned up');

const checks = new Checks();
aaQuickChecks(checks, { result: q, brand: 'Dragonpass', variant: 'Default' });
aaFullChecks(checks, { result: full, brand: 'Dragonpass', variant: 'Default' });
const s = a11ySummary([{ key: 'x', name: 'Fixture', checks: checks.list() }]);
const sc = Object.fromEntries(s.criteria.map((c) => [c.sc, c.status]));
for (const k of ['1.4.11', '2.5.3', '1.4.4', '1.4.12', '1.4.10', '2.4.7', '2.4.11']) assert.equal(sc[k], 'fail', k + ' fails');
assert.equal(sc['2.1.2'], 'pass');
assert.equal(s.coverage.total, 55, 'every A and AA criterion is listed');
assert.equal(s.criteria.length + s.manual.length, 55);
assert.ok(s.manual.some((m) => m.sc === '3.3.1'), 'error identification needs a person');
assert.ok(!s.criteria.some((c) => /AAA/.test(c.level)));
await b.close();
console.log('✓ AA page checks test passed');
