// Accessibility scope: minimum AA only, disabled states skipped.
import assert from 'node:assert/strict';
import { isDisabledState, isAtMostAA, designA11yChecks } from '../src/a11y.js';
import { a11yChecks, Checks } from '../src/compare.js';
import { DEFAULTS as defaults } from '../src/config.js';

const V = (name, props) => ({ name, props: props ?? Object.fromEntries(name.split(', ').map((p) => p.split('='))) });
assert.equal(isDisabledState(V('Type=Primary, State=Disabled')), true);
assert.equal(isDisabledState(V('Type=Primary, State=Default')), false);
assert.equal(isDisabledState(V('Disabled=True, Size=Small')), true);
assert.equal(isDisabledState(V('Disabled=False, Size=Small')), false, 'Disabled=False is the enabled state');
assert.equal(isDisabledState(V('Status=Inactive')), true);
assert.equal(isDisabledState(V('State=Expired')), false, 'expired is not disabled');
assert.equal(isDisabledState(V('Type=Primary, State=Loading'), { loading: true }), false, 'loading is its own state, even if code disables the button');
assert.equal(isDisabledState(V('Type=Primary'), { disabled: true }), true);
assert.equal(isDisabledState(V('Type=Primary'), { disabled: false }), false);
assert.equal(isDisabledState(V('Type=Primary'), { state: 'disabled' }), true);
assert.equal(isDisabledState(V('Type=Primary'), { label: 'Discount' }), false);

assert.equal(isAtMostAA(['cat.color', 'wcag2aa', 'wcag143']), true);
assert.equal(isAtMostAA(['wcag22aa', 'wcag258']), true);
assert.equal(isAtMostAA(['cat.color', 'wcag2aaa', 'wcag146']), false, 'AAA is not counted');
assert.equal(isAtMostAA(['best-practice']), false);
assert.ok(!defaults.a11y.tags.some((t) => /aaa|best-practice|experimental/.test(t)));

// axe results: AAA / best-practice violations never become issues
const checks = new Checks();
a11yChecks(checks, { brand: 'Dragonpass', variant: 'State=Default', cfg: defaults, result: { violations: [
  { id: 'color-contrast', impact: 'serious', help: 'Contrast', tags: ['wcag2aa', 'wcag143'], nodes: 1, target: 'p', summary: '' },
  { id: 'color-contrast-enhanced', impact: 'serious', help: 'Enhanced contrast', tags: ['wcag2aaa', 'wcag146'], nodes: 1, target: 'p', summary: '' },
  { id: 'region', impact: 'moderate', help: 'Landmarks', tags: ['best-practice'], nodes: 1, target: 'div', summary: '' },
] } });
const subjects = checks.list().map((c) => c.subject);
assert.ok(subjects.includes('axe:color-contrast'));
assert.ok(!subjects.includes('axe:color-contrast-enhanced'));
assert.ok(!subjects.includes('axe:region'));

// Figma: a disabled variant gets no contrast check
const c2 = new Checks();
designA11yChecks(c2, { variant: { name: 'State=Disabled', props: { State: 'Disabled' }, layers: [{ type: 'TEXT', raw: { characters: 'Go' } }] }, brands: ['Dragonpass'] });
assert.equal(c2.list().length, 0);
console.log('✓ accessibility scope test passed');

// Figma non-text contrast (1.4.11)
{
  const L = (path, type, raw, depth) => ({ path, name: path.split(' / ').pop(), type, depth, raw, bindings: {} });
  const field = { name: 'State=Default', props: { State: 'Default' }, layers: [
    L('Card', 'FRAME', { fills: '#FFFFFF', strokeWeight: 0 }, 0),
    L('Card / Input', 'FRAME', { fills: '#FFFFFF', strokes: '#E6E6E6', strokeWeight: 1 }, 1),
    L('Card / Input / Label', 'TEXT', { fills: '#222222', characters: 'Email', fontSize: 16 }, 2),
  ] };
  const c3 = new Checks();
  designA11yChecks(c3, { component: 'Text Input', variant: field, brands: ['Dragonpass'], defaultBrand: 'Dragonpass' });
  const nt = c3.list().find((c) => c.subject === 'design:non-text');
  assert.equal(nt.status, 'fail', 'pale field border on a white card fails');
  const good = JSON.parse(JSON.stringify(field)); good.layers[1].raw.strokes = '#767676';
  const c4 = new Checks();
  designA11yChecks(c4, { component: 'Text Input', variant: good, brands: ['Dragonpass'], defaultBrand: 'Dragonpass' });
  assert.equal(c4.list().find((c) => c.subject === 'design:non-text').status, 'pass');
  const icon = { name: 'Type=Close', props: { Type: 'Close' }, layers: [L('Btn', 'FRAME', { fills: '#FFFFFF', strokeWeight: 0 }, 0), L('Btn / x', 'VECTOR', { fills: '#DDDDDD', strokeWeight: 0 }, 1)] };
  const c5 = new Checks();
  designA11yChecks(c5, { component: 'Icon Button', variant: icon, brands: ['Dragonpass'], defaultBrand: 'Dragonpass' });
  assert.equal(c5.list().find((c) => c.subject === 'design:non-text').status, 'fail', 'pale icon-only button fails');
  const c6 = new Checks();
  designA11yChecks(c6, { component: 'Banner', variant: { name: 'Type=Info', props: {}, layers: [L('B', 'FRAME', { fills: '#FFFFFF' }, 0), L('B / t', 'TEXT', { fills: '#111111', characters: 'Hi' }, 1)] }, brands: ['Dragonpass'], defaultBrand: 'Dragonpass' });
  assert.ok(!c6.list().some((c) => c.subject === 'design:non-text'), 'text components without fields are not checked for 1.4.11');
}
console.log('✓ Figma non-text contrast test passed');
