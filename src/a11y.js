// Accessibility: WCAG mapping, a design-side contrast check that reads Figma's per-brand tokens,
// and a summary that says whether each problem starts in Figma or in code.
import { parseColor, colorToHex } from './util.js';

const U = (slug) => `https://www.w3.org/WAI/WCAG22/Understanding/${slug}`;
export const CRITERIA = {
  '1.1.1': { name: 'Non-text content', level: 'A', url: U('non-text-content') },
  '1.3.1': { name: 'Info and relationships', level: 'A', url: U('info-and-relationships') },
  '1.4.1': { name: 'Use of colour', level: 'A', url: U('use-of-color') },
  '1.4.3': { name: 'Contrast (minimum)', level: 'AA', url: U('contrast-minimum') },
  '1.4.4': { name: 'Resize text', level: 'AA', url: U('resize-text') },
  '1.4.11': { name: 'Non-text contrast', level: 'AA', url: U('non-text-contrast') },
  '1.4.12': { name: 'Text spacing', level: 'AA', url: U('text-spacing') },
  '2.1.1': { name: 'Keyboard', level: 'A', url: U('keyboard') },
  '2.4.4': { name: 'Link purpose', level: 'A', url: U('link-purpose-in-context') },
  '2.4.7': { name: 'Focus visible', level: 'AA', url: U('focus-visible') },
  '2.5.3': { name: 'Label in name', level: 'A', url: U('label-in-name') },
  '2.5.8': { name: 'Target size (minimum)', level: 'AA', url: U('target-size-minimum') },
  '3.3.2': { name: 'Labels or instructions', level: 'A', url: U('labels-or-instructions') },
  '4.1.2': { name: 'Name, role, value', level: 'A', url: U('name-role-value') },
};

// Plain-language explanations. `why` is what it means for people; `fix` is what to change.
const RULES = {
  'color-contrast': { sc: '1.4.3', title: 'Text contrast is too low in Storybook', why: "People with low vision, or reading in bright light, can't make out the text.", fix: 'Pair text and background tokens that reach 4.5:1, or 3:1 for text 24px and larger (19px bold).' },
  'design-contrast': { sc: '1.4.3', title: 'Text contrast is too low in Figma', why: "The design itself doesn't reach the minimum, so code built to spec will fail too.", fix: 'Change the brand value of the text or background token in Figma until the pair reaches 4.5:1 (3:1 for large text).' },
  'button-name': { sc: '4.1.2', title: 'Button has no accessible name', why: 'Screen readers announce only "button", so people can\'t tell what it does.', fix: 'Give the button a name screen readers can read: visible text, or aria-label for icon-only and loading states.' },
  'link-name': { sc: '2.4.4', title: 'Link has no accessible name', why: "Screen reader users hear \"link\" with no idea where it goes.", fix: 'Give the link visible text, or an aria-label when it is icon-only.' },
  'image-alt': { sc: '1.1.1', title: 'Image has no text alternative', why: "Screen reader users miss what the image shows.", fix: 'Add alt text, or alt="" when the image is decorative.' },
  'svg-img-alt': { sc: '1.1.1', title: 'Icon has no text alternative', why: 'Meaningful icons are silent to screen readers.', fix: 'Add a title or aria-label to meaningful icons; hide decorative ones with aria-hidden.' },
  'role-img-alt': { sc: '1.1.1', title: 'Image role has no text alternative', why: 'Screen readers announce an image with no description.', fix: 'Add aria-label, or remove role="img" when decorative.' },
  label: { sc: '4.1.2', title: 'Form field has no label', why: "Screen reader users don't know what to type.", fix: 'Connect a visible label to the field, or add aria-label.' },
  'select-name': { sc: '4.1.2', title: 'Dropdown has no label', why: "Screen reader users don't know what they're choosing.", fix: 'Connect a visible label, or add aria-label.' },
  'aria-input-field-name': { sc: '4.1.2', title: 'Input has no accessible name', why: "Screen reader users don't know what the field is for.", fix: 'Add aria-label or aria-labelledby.' },
  'aria-toggle-field-name': { sc: '4.1.2', title: 'Toggle has no accessible name', why: "Screen reader users don't know what they're switching.", fix: 'Add aria-label or a visible label.' },
  'aria-command-name': { sc: '4.1.2', title: 'Control has no accessible name', why: 'Screen readers can\'t say what the control does.', fix: 'Add aria-label or visible text.' },
  'aria-progressbar-name': { sc: '1.1.1', title: 'Progress indicator has no name', why: 'Screen reader users hear progress with no context.', fix: 'Add aria-label, for example "Loading".' },
  'aria-tooltip-name': { sc: '4.1.2', title: 'Tooltip has no text', why: 'Screen readers announce an empty tooltip.', fix: 'Make sure the tooltip has text content.' },
  'aria-allowed-attr': { sc: '4.1.2', title: 'ARIA attribute not allowed on this element', why: 'Assistive technology may announce the wrong thing.', fix: 'Remove the attribute or use an element whose role supports it.' },
  'aria-required-attr': { sc: '4.1.2', title: 'Required ARIA attribute missing', why: 'Assistive technology can\'t report the state, like checked or expanded.', fix: 'Add the attribute the role needs, for example aria-checked on a switch.' },
  'aria-valid-attr-value': { sc: '4.1.2', title: 'ARIA attribute has an invalid value', why: 'Assistive technology ignores or misreports it.', fix: 'Use a value the attribute allows.' },
  'aria-hidden-focus': { sc: '4.1.2', title: 'Hidden element can still take focus', why: 'Keyboard users land on something screen readers say isn\'t there.', fix: 'Add tabindex="-1" to focusable children, or don\'t hide the element.' },
  'nested-interactive': { sc: '4.1.2', title: 'Control nested inside another control', why: 'Screen readers announce one and skip the other.', fix: 'Don\'t put buttons or links inside other buttons or links.' },
  list: { sc: '1.3.1', title: 'List built incorrectly', why: 'Screen readers can\'t say how many items there are.', fix: 'Only put li elements directly inside ul or ol.' },
  listitem: { sc: '1.3.1', title: 'List item outside a list', why: 'Screen readers lose the list structure.', fix: 'Wrap li elements in ul or ol.' },
  'link-in-text-block': { sc: '1.4.1', title: 'Link only told apart by colour', why: 'People who can\'t see the colour difference can\'t find the link.', fix: 'Underline links in body text.' },
  'scrollable-region-focusable': { sc: '2.1.1', title: 'Scrolling area can\'t be reached by keyboard', why: 'Keyboard users can\'t scroll to the hidden content.', fix: 'Make the scrolling area focusable with tabindex="0".' },
  'target-size': { sc: '2.5.8', title: 'Touch target is too small', why: 'People with tremors or large fingers tap the wrong thing.', fix: 'Make the tappable area at least 24 × 24px. Padding counts.' },
  keyboard: { sc: '2.1.1', title: "Can't be reached with the keyboard", why: 'Keyboard and switch users can\'t use the component at all.', fix: 'Use a native button or link, or add tabindex="0" and key handlers.' },
  'focus-visible': { sc: '2.4.7', title: 'No visible focus indicator', why: 'Keyboard users lose track of where they are.', fix: 'Show a focus ring with at least 3:1 contrast. Add it as a Focus state in Figma so the build matches.' },
  'design-focus': { sc: '2.4.7', title: 'No Focus state in Figma', why: 'Without a designed focus style, each team invents its own or leaves it out.', fix: 'Add a Focus variant to the component set with a ring that reaches 3:1.' },
};
const IMPACT = { critical: 4, serious: 3, moderate: 2, minor: 1 };
const AXE_COVERS = ['1.1.1', '1.3.1', '1.4.3', '4.1.2'];

function scFromTags(tags = []) {
  for (const t of tags) { const m = String(t).match(/^wcag(\d)(\d)(\d+)$/); if (m) return `${m[1]}.${m[2]}.${m[3]}`; }
  return null;
}
export function ruleInfo(rule, tags) {
  const r = RULES[rule] ?? {};
  const sc = r.sc ?? scFromTags(tags) ?? null;
  return { rule, sc, criterion: sc ? { sc, ...(CRITERIA[sc] ?? { name: `WCAG ${sc}`, level: '', url: U('') }) } : null, title: r.title ?? null, why: r.why ?? null, fix: r.fix ?? null };
}

// ---------------------------------------------------------------- contrast maths
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
export function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
const over = (top, under) => {
  const a = top.a ?? 1;
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
};
const WHITE = { r: 255, g: 255, b: 255, a: 1 };

function bound(layer, key, variables) {
  const id = layer.bindings?.[key]?.[0];
  return id ? variables[id] ?? { unknown: true } : null;
}
function valueFor(layer, key, brand, variables, defaultBrand) {
  const v = bound(layer, key, variables);
  if (v && !v.unknown && v.valuesByBrand?.[brand] !== undefined) return { value: v.valuesByBrand[brand], token: v.name };
  if (v && brand !== defaultBrand) return null; // linked, but we don't know this brand's value
  const raw = layer.raw?.[key];
  return raw === undefined || raw === null ? null : { value: raw, token: v && !v.unknown ? v.name : null };
}

/** Checks the Figma design itself: text contrast per brand, read from token values. Skips disabled states (WCAG exempts them). */
export function designA11yChecks(checks, { variant, brands, variables = {}, defaultBrand }) {
  const label = `${variant.name} ${Object.values(variant.props ?? {}).join(' ')}`;
  if (/disabled|inactive/i.test(label)) return;
  const layers = variant.layers ?? [];
  const texts = layers.filter((l) => l.type === 'TEXT' && String(l.raw?.characters ?? 'x').trim()).slice(0, 4);
  if (!texts.length) return;
  const onDark = /inverse|dark|reverse|on.?colou?r|on.?brand|overlay|on.?image/i.test(label);
  for (const brand of brands) {
    let worst = null;
    for (const t of texts) {
      const f = valueFor(t, 'fills', brand, variables, defaultBrand);
      const fgRaw = f && parseColor(f.value);
      if (!fgRaw || fgRaw.a === 0) continue;
      const anc = layers.filter((l) => l !== t && t.path.startsWith(`${l.path} / `)).sort((a, b) => b.depth - a.depth);
      let bg = null, bgToken = null;
      for (const a of anc) {
        const b = valueFor(a, 'fills', brand, variables, defaultBrand);
        const c = b && parseColor(b.value);
        if (c && c.a > 0) { bg = c.a < 1 ? over(c, WHITE) : c; bgToken = b.token; break; }
      }
      const assumed = !bg;
      if (assumed && onDark) continue;
      if (assumed) bg = WHITE;
      const opacity = (t.raw?.opacity ?? 1) * (fgRaw.a ?? 1);
      const fg = over({ ...fgRaw, a: opacity }, bg);
      const size = Number(valueFor(t, 'fontSize', brand, variables, defaultBrand)?.value ?? t.raw?.fontSize ?? 16);
      const weight = Number(valueFor(t, 'fontWeight', brand, variables, defaultBrand)?.value ?? t.raw?.fontWeight ?? 400);
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const required = large ? 3 : 4.5;
      const ratio = Math.round(contrast(fg, bg) * 100) / 100;
      const hit = { ratio, required, fg: colorToHex(fg), bg: colorToHex(bg), fgToken: f.token, bgToken, size, weight, layer: t.name, assumed };
      if (!worst || ratio / required < worst.ratio / worst.required) worst = hit;
    }
    if (!worst) continue;
    const ok = worst.ratio >= worst.required;
    checks.add({ category: 'Accessibility', subject: 'design:contrast', label: 'Text contrast in Figma', status: ok ? 'pass' : worst.assumed ? 'warn' : 'fail', owner: 'Design',
      title: ok ? 'Text contrast passes in Figma' : 'Text contrast is too low in Figma',
      detail: `${worst.ratio}:1, needs ${worst.required}:1 · ${worst.fg} on ${worst.bg}${worst.assumed ? ' (no background in the component, measured on white)' : ''}`,
      brand, variant: variant.name, meta: { rule: 'design-contrast', source: 'design', impact: 'serious' }, extra: worst });
  }
}

// ---------------------------------------------------------------- summary
export function a11ySummary(components) {
  const issues = new Map();
  const tested = new Map();
  let scans = 0, designChecks = 0;
  const brands = new Set();
  const designIndex = new Map(); // component|brand|variant → design contrast
  for (const c of components) {
    for (const ch of c.checks) {
      if (ch.meta?.rule !== 'design-contrast') continue;
      for (const i of ch.instances) if (i.extra) designIndex.set(`${c.key}|${i.brand}|${i.variant}`, i.extra);
    }
  }
  for (const c of components) {
    for (const ch of c.checks) {
      const m = ch.meta;
      if (!m) continue;
      if (m.rule === 'scan') { scans += ch.instances.length; ch.instances.forEach((i) => i.brand && brands.add(i.brand)); AXE_COVERS.forEach((sc) => { if (!tested.has(sc)) tested.set(sc, 'pass'); }); continue; }
      const info = ruleInfo(m.rule, m.tags);
      if (m.rule === 'design-contrast') designChecks += ch.instances.length;
      const sc = info.criterion?.sc;
      if (sc) { const prev = tested.get(sc); const rank = { pass: 0, warn: 1, fail: 2 }; if (!prev || rank[ch.status] > rank[prev]) tested.set(sc, ch.status); }
      if (ch.status === 'pass' || ch.status === 'info') continue;
      const impact = m.rule === 'design-contrast' && ch.status === 'warn' ? 'moderate' : (m.impact ?? (ch.status === 'fail' ? 'serious' : 'moderate'));
      if (!issues.has(m.rule)) {
        issues.set(m.rule, { rule: m.rule, criterion: info.criterion, title: info.title ?? ch.title, why: info.why, fix: info.fix, impact, status: ch.status, owner: ch.owner, source: m.source, help: m.source === 'code' && m.rule !== 'keyboard' && m.rule !== 'focus-visible' && m.rule !== 'target-size' ? ch.instances.find((i) => i.code)?.code ?? null : null, components: [], where: [] });
      }
      const it = issues.get(m.rule);
      if (IMPACT[impact] > IMPACT[it.impact]) it.impact = impact;
      if (ch.status === 'fail') it.status = 'fail';
      if (!it.components.some((x) => x.key === c.key)) it.components.push({ name: c.name, key: c.key });
      const groups = new Map();
      for (const i of ch.instances.filter((x) => x.status !== 'pass')) {
        const k = `${i.brand ?? ''}`;
        if (!groups.has(k)) groups.set(k, { component: c.name, componentKey: c.key, brand: i.brand, variants: [], status: i.status, detail: i.detail, contrast: null, design: null, target: i.extra?.target ?? null, size: i.extra?.w ? { w: i.extra.w, h: i.extra.h, min: i.extra.min } : null });
        const g = groups.get(k);
        if (i.variant && !g.variants.includes(i.variant)) g.variants.push(i.variant);
        if (i.status === 'fail') g.status = 'fail';
        if (i.extra?.ratio && (!g.contrast || i.extra.ratio < g.contrast.ratio)) {
          g.contrast = { ratio: i.extra.ratio, required: i.extra.required, fg: i.extra.fg, bg: i.extra.bg, fgToken: i.extra.fgToken ?? null, bgToken: i.extra.bgToken ?? null, assumed: !!i.extra.assumed, variant: i.variant };
          if (m.rule === 'color-contrast') g.design = designIndex.get(`${c.key}|${i.brand}|${i.variant}`) ?? null;
        }
      }
      it.where.push(...groups.values());
    }
  }
  // Who fixes code contrast: if Figma fails too, it starts in the design
  for (const it of issues.values()) {
    if (it.rule !== 'color-contrast') continue;
    const known = it.where.filter((w) => w.design);
    const designFails = known.filter((w) => w.design.ratio < w.design.required);
    it.verdict = !known.length ? null : designFails.length === known.length ? 'design' : designFails.length ? 'mixed' : 'code';
    if (it.verdict === 'design') it.owner = 'Design';
    else if (it.verdict === 'code') it.owner = 'Dev';
    else if (it.verdict === 'mixed') it.owner = 'Both';
  }
  const list = [...issues.values()].map((it) => ({ ...it, occurrences: it.where.reduce((n, w) => n + Math.max(1, w.variants.length), 0) }))
    .sort((a, b) => IMPACT[b.impact] - IMPACT[a.impact] || (b.status === 'fail') - (a.status === 'fail') || b.occurrences - a.occurrences);
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  list.forEach((i) => { counts[i.impact] = (counts[i.impact] ?? 0) + 1; });
  const byBrand = {};
  list.forEach((i) => i.where.forEach((w) => { if (w.brand) byBrand[w.brand] = (byBrand[w.brand] ?? 0) + Math.max(1, w.variants.length); }));
  const criteria = [...tested.entries()].map(([sc, status]) => ({ sc, ...(CRITERIA[sc] ?? { name: `WCAG ${sc}`, level: '' }), status, issues: list.filter((i) => i.criterion?.sc === sc).length }))
    .sort((a, b) => a.sc.localeCompare(b.sc, undefined, { numeric: true }));
  return {
    ran: scans > 0 || designChecks > 0, scans, designChecks, brands: [...brands], counts, total: list.length,
    components: new Set(list.flatMap((i) => i.components.map((c) => c.key))).size,
    byBrand, criteria, issues: list,
  };
}
