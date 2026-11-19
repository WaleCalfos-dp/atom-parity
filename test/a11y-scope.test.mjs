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
