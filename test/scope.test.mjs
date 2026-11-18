import assert from 'node:assert/strict';
import { pagesInScope, sectionMap } from '../src/figma-rest.js';
const names = ['━ CORE COMPONENTS ━━━','ACTIONS','      ❖ Button','━ PATTERNS ━━━━','      ↳ Bottom Sheet','━ PRODUCT MODULES ━━━','      🛋️ Lounge','      💳 Membership','---','━ DEPRECATED ━━━','      ❖ Cards (deprecated)'];
const pages = names.map((name, i) => ({ id: `p${i}`, name }));
const sections = sectionMap(pages);
const pick = (n) => pagesInScope(pages, sections, pages.find((p) => p.name === n), ['archive', 'deprecated', 'playground']).map((id) => pages.find((p) => p.id === id).name.trim());
assert.deepEqual(pick('━ PRODUCT MODULES ━━━'), ['🛋️ Lounge', '💳 Membership']);
assert.deepEqual(pick('━ PATTERNS ━━━━'), ['↳ Bottom Sheet']);
assert.deepEqual(pick('ACTIONS'), ['❖ Button']);
assert.deepEqual(pick('━ DEPRECATED ━━━'), []);
console.log('✓ scope pages');

// Figma folder prefixes: "Flight Delay / Flight Card" pairs with FlightCard; a generic last word does not
import { matchComponents } from '../src/match.js';
{
  const code = ['Business Components/FlightCard', 'Business Components/Promotion Panel', 'Data Display/Steps'].map((t) => ({ title: t, name: t.split('/').pop() }));
  const fig = ['Flight Delay / Flight Card', 'Transport / Promotion Panel', 'Progress Bar / Steps'].map((name) => ({ name }));
  const r = matchComponents(fig, code, { components: { aliases: {} } });
  assert.deepEqual(r.pairs.map((p) => p.code.title), ['Business Components/FlightCard', 'Business Components/Promotion Panel']);
  assert.deepEqual(r.missingInCode.map((m) => m.figma.name), ['Progress Bar / Steps']);
  console.log('✓ folder-prefixed names');
}
