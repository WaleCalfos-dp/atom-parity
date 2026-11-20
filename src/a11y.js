// Accessibility: WCAG mapping, a design-side contrast check that reads Figma's per-brand tokens,
// and a summary that says whether each problem starts in Figma or in code.
import { parseColor, colorToHex } from './util.js';

const U = (slug) => `https://www.w3.org/WAI/WCAG22/Understanding/${slug}`;
// Every WCAG 2.2 success criterion at level A and AA (4.1.1 Parsing was removed in 2.2). `auto` marks the ones these
// checks can test on a rendered component; the rest need a person (or apply to whole pages, not components).
const C = (name, level, slug, auto = false) => ({ name, level, url: U(slug), auto });
export const CRITERIA = {
  '1.1.1': C('Non-text content', 'A', 'non-text-content', true),
  '1.2.1': C('Audio-only and video-only (prerecorded)', 'A', 'audio-only-and-video-only-prerecorded'),
  '1.2.2': C('Captions (prerecorded)', 'A', 'captions-prerecorded'),
  '1.2.3': C('Audio description or media alternative (prerecorded)', 'A', 'audio-description-or-media-alternative-prerecorded'),
  '1.2.4': C('Captions (live)', 'AA', 'captions-live'),
  '1.2.5': C('Audio description (prerecorded)', 'AA', 'audio-description-prerecorded'),
  '1.3.1': C('Info and relationships', 'A', 'info-and-relationships', true),
  '1.3.2': C('Meaningful sequence', 'A', 'meaningful-sequence'),
  '1.3.3': C('Sensory characteristics', 'A', 'sensory-characteristics'),
  '1.3.4': C('Orientation', 'AA', 'orientation'),
  '1.3.5': C('Identify input purpose', 'AA', 'identify-input-purpose', true),
  '1.4.1': C('Use of colour', 'A', 'use-of-color', true),
  '1.4.2': C('Audio control', 'A', 'audio-control'),
  '1.4.3': C('Contrast (minimum)', 'AA', 'contrast-minimum', true),
  '1.4.4': C('Resize text', 'AA', 'resize-text', true),
  '1.4.5': C('Images of text', 'AA', 'images-of-text'),
  '1.4.10': C('Reflow', 'AA', 'reflow', true),
  '1.4.11': C('Non-text contrast', 'AA', 'non-text-contrast', true),
  '1.4.12': C('Text spacing', 'AA', 'text-spacing', true),
  '1.4.13': C('Content on hover or focus', 'AA', 'content-on-hover-or-focus'),
  '2.1.1': C('Keyboard', 'A', 'keyboard', true),
  '2.1.2': C('No keyboard trap', 'A', 'no-keyboard-trap', true),
  '2.1.4': C('Character key shortcuts', 'A', 'character-key-shortcuts'),
  '2.2.1': C('Timing adjustable', 'A', 'timing-adjustable'),
  '2.2.2': C('Pause, stop, hide', 'A', 'pause-stop-hide'),
  '2.3.1': C('Three flashes or below threshold', 'A', 'three-flashes-or-below-threshold'),
  '2.4.1': C('Bypass blocks', 'A', 'bypass-blocks'),
  '2.4.2': C('Page titled', 'A', 'page-titled'),
  '2.4.3': C('Focus order', 'A', 'focus-order'),
  '2.4.4': C('Link purpose (in context)', 'A', 'link-purpose-in-context', true),
  '2.4.5': C('Multiple ways', 'AA', 'multiple-ways'),
  '2.4.6': C('Headings and labels', 'AA', 'headings-and-labels'),
  '2.4.7': C('Focus visible', 'AA', 'focus-visible', true),
  '2.4.11': C('Focus not obscured (minimum)', 'AA', 'focus-not-obscured-minimum', true),
  '2.5.1': C('Pointer gestures', 'A', 'pointer-gestures'),
  '2.5.2': C('Pointer cancellation', 'A', 'pointer-cancellation'),
  '2.5.3': C('Label in name', 'A', 'label-in-name', true),
  '2.5.4': C('Motion actuation', 'A', 'motion-actuation'),
  '2.5.7': C('Dragging movements', 'AA', 'dragging-movements'),
  '2.5.8': C('Target size (minimum)', 'AA', 'target-size-minimum', true),
  '3.1.1': C('Language of page', 'A', 'language-of-page'),
  '3.1.2': C('Language of parts', 'AA', 'language-of-parts'),
  '3.2.1': C('On focus', 'A', 'on-focus'),
  '3.2.2': C('On input', 'A', 'on-input'),
  '3.2.3': C('Consistent navigation', 'AA', 'consistent-navigation'),
  '3.2.4': C('Consistent identification', 'AA', 'consistent-identification'),
  '3.2.6': C('Consistent help', 'A', 'consistent-help'),
  '3.3.1': C('Error identification', 'A', 'error-identification'),
  '3.3.2': C('Labels or instructions', 'A', 'labels-or-instructions', true),
  '3.3.3': C('Error suggestion', 'AA', 'error-suggestion'),
  '3.3.4': C('Error prevention (legal, financial, data)', 'AA', 'error-prevention-legal-financial-data'),
  '3.3.7': C('Redundant entry', 'A', 'redundant-entry'),
  '3.3.8': C('Accessible authentication (minimum)', 'AA', 'accessible-authentication-minimum'),
  '4.1.2': C('Name, role, value', 'A', 'name-role-value', true),
  '4.1.3': C('Status messages', 'AA', 'status-messages'),
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
  'non-text-contrast': { sc: '1.4.11', title: 'Field edge or icon is hard to see in Storybook', why: "People with low vision can't find the field, checkbox or icon-only button.", fix: 'Give the border, fill or icon at least 3:1 contrast against what is around it.' },
  'design-non-text': { sc: '1.4.11', title: 'Field edge or icon is hard to see in Figma', why: "The design itself doesn't reach 3:1, so code built to spec will fail too.", fix: 'Use border, fill or icon tokens that reach 3:1 against the background in every brand.' },
  'label-in-name': { sc: '2.5.3', title: "Spoken name doesn't match the visible label", why: 'Voice control users say what they see, and nothing happens.', fix: 'Make the aria-label start with, or at least contain, the visible text. Or remove the aria-label.' },
  'keyboard-trap': { sc: '2.1.2', title: 'Keyboard focus gets stuck', why: "Keyboard users can't leave the component, so they're stuck on the page.", fix: 'Let Tab and Shift+Tab move focus out. Only trap focus inside an open dialog, and close it with Escape.' },
  'pointer-only': { sc: '2.1.1', title: 'Looks clickable but the keyboard skips it', why: "It has a pointer cursor, so it's probably clickable, but keyboard users can't reach it.", fix: 'If it does something, use a button or link. If not, remove cursor: pointer.' },
  'focus-obscured': { sc: '2.4.11', title: 'Focused control is hidden behind something', why: "Keyboard users can't see where they are.", fix: "Make sure nothing (a sticky bar, an overlay) covers a control when it has focus." },
  'resize-text': { sc: '1.4.4', title: 'Text gets cut off at 200% size', why: 'People who enlarge text lose part of the content.', fix: 'Let containers grow with the text: avoid fixed heights and widths with overflow hidden around text.' },
  'text-spacing': { sc: '1.4.12', title: 'Text gets cut off with wider spacing', why: "People who need more line, letter or word spacing to read lose part of the content.", fix: 'Avoid fixed heights on text containers so wider spacing has room.' },
  reflow: { sc: '1.4.10', title: "Doesn't fit a 320px-wide screen", why: 'On small screens or when zoomed to 400%, people have to scroll sideways to read.', fix: 'Let the component shrink to 320px: use flexible widths and let content wrap.' },
  'design-focus': { sc: '2.4.7', title: 'No Focus state in Figma', why: 'Without a designed focus style, each team invents its own or leaves it out.', fix: 'Add a Focus variant to the component set with a ring that reaches 3:1.' },
};
const IMPACT = { critical: 4, serious: 3, moderate: 2, minor: 1 };
// Criteria axe tests on any rendered story; others count only when a rule actually applied (listed by the scan)
const AXE_COVERS = ['1.1.1', '1.3.1', '1.4.3', '4.1.2'];
// axe rules that test Storybook's own page (title, language, viewport meta, skip links), not the component
const PAGE_LEVEL = new Set(['2.4.1', '2.4.2', '3.1.1', '1.4.4']);

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

// Only WCAG level A and AA count. axe tags each rule with its level; AAA (wcag2aaa…), best-practice and experimental never do.
const AA_TAG = /^wcag2(1|2)?a{1,2}$/;
export const isAtMostAA = (tags = []) => tags.some((t) => AA_TAG.test(t)) && !tags.includes('experimental');

/** A disabled (inactive) state, from the Figma variant ("State=Disabled", "Disabled=True") or the Storybook args
 *  (disabled: true, state: 'disabled'). WCAG exempts these from contrast, and nobody can use them, so they aren't checked. */
const OFF = /\b(disabled?|inactive)\b/i;
export function isDisabledState(variant = {}, args = {}) {
  const props = variant.props ?? {};
  if (OFF.test(variant.name ?? '')) {
    // "Disabled=False" names the property, not the state
    const named = Object.entries(props).filter(([k]) => OFF.test(k));
    if (!named.length || named.some(([, v]) => /^(true|yes|on)$/i.test(String(v)))) return true;
    if (Object.entries(props).some(([k, v]) => !OFF.test(k) && OFF.test(String(v)))) return true;
  } else if (Object.values(props).some((v) => OFF.test(String(v)))) return true;
  return Object.entries(args).some(([k, v]) => (OFF.test(k) && (v === true || /^(true|yes)$/i.test(String(v)))) || (typeof v === 'string' && OFF.test(v)));
}

/** Checks the Figma design itself: text contrast per brand, read from token values. Skips disabled states (WCAG exempts them). */
export function designA11yChecks(checks, { component = '', variant, brands, variables = {}, defaultBrand }) {
  if (isDisabledState(variant)) return;
  const label = `${variant.name} ${Object.values(variant.props ?? {}).join(' ')}`;
  const layers = variant.layers ?? [];
  const texts = layers.filter((l) => l.type === 'TEXT' && String(l.raw?.characters ?? 'x').trim()).slice(0, 4);
  designNonText(checks, { component, variant, label, layers, texts, brands, variables, defaultBrand });
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

// Non-text contrast in Figma (1.4.11): a field needs a border or fill that reaches 3:1 against what's around it
// (measured on white, the usual surface); a variant with no text is identified by its icon, which needs 3:1 too.
const FIELDISH = /input|field|text ?area|select|dropdown|search|check ?box|radio|switch|toggle|stepper|slider|otp|pin ?code/i;
const SHAPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'STAR', 'LINE', 'REGULAR_POLYGON', 'RECTANGLE']);
function designNonText(checks, { component, variant, label, layers, texts, brands, variables, defaultBrand }) {
  const isField = FIELDISH.test(component) || FIELDISH.test(label);
  const iconOnly = !texts.length;
  if (!isField && !iconOnly) return;
  const colourOf = (l, key, brand) => { const v = valueFor(l, key, brand, variables, defaultBrand); const c = v && parseColor(v.value); return c && c.a > 0 ? { c, token: v.token } : null; };
  const behindOf = (l, brand) => {
    const anc = layers.filter((a) => a !== l && l.path.startsWith(`${a.path} / `)).sort((a, b) => b.depth - a.depth);
    for (const a of anc) { const f = colourOf(a, 'fills', brand); if (f) return { c: f.c.a < 1 ? over(f.c, WHITE) : f.c, token: f.token }; }
    return { c: WHITE, token: null, assumed: true };
  };
  for (const brand of brands) {
    let best = null;
    if (isField) {
      // The edge: a stroke or fill on the component or the frames just inside it
      const minDepth = Math.min(...layers.map((l) => l.depth ?? 0));
      for (const l of layers.filter((x) => (x.depth ?? 0) <= minDepth + 2 && x.type !== 'TEXT')) {
        const out = behindOf(l, brand);
        for (const key of ['strokes', 'fills']) {
          if (key === 'strokes' && !(l.raw?.strokeWeight > 0)) continue;
          const f = colourOf(l, key, brand);
          if (!f) continue;
          const fg = over(f.c, out.c);
          const r = Math.round(contrast(fg, out.c) * 100) / 100;
          if (!best || r > best.ratio) best = { ratio: r, required: 3, fg: colorToHex(fg), bg: colorToHex(out.c), fgToken: f.token, bgToken: out.token, part: key === 'strokes' ? 'border' : 'fill', layer: l.name, assumed: !!out.assumed };
        }
      }
    } else {
      // Icon-only: the weakest icon shape against what's behind it
      for (const l of layers.filter((x) => SHAPES.has(x.type))) {
        const f = colourOf(l, 'fills', brand) || (l.raw?.strokeWeight > 0 ? colourOf(l, 'strokes', brand) : null);
        if (!f) continue;
        const out = behindOf(l, brand);
        if (l.type === 'RECTANGLE' && !out.assumed) continue; // a background plate, not the icon
        const fg = over({ ...f.c, a: (f.c.a ?? 1) * (l.raw?.opacity ?? 1) }, out.c);
        const r = Math.round(contrast(fg, out.c) * 100) / 100;
        const hit = { ratio: r, required: 3, fg: colorToHex(fg), bg: colorToHex(out.c), fgToken: f.token, bgToken: out.token, part: 'icon', layer: l.name, assumed: !!out.assumed };
        if (!best || r > best.ratio) best = hit; // one clearly visible shape is enough to identify it
      }
    }
    if (!best) continue;
    const ok = best.ratio >= 3;
    checks.add({ category: 'Accessibility', subject: 'design:non-text', label: 'Non-text contrast in Figma', status: ok ? 'pass' : best.assumed ? 'warn' : 'fail', owner: 'Design',
      title: ok ? 'Field edges and icons reach 3:1 in Figma' : best.part === 'icon' ? 'Icon is hard to see in Figma' : 'Field edge is hard to see in Figma',
      detail: `${best.part} ${best.ratio}:1, needs 3:1 · ${best.fg} on ${best.bg}${best.assumed ? ' (measured on white)' : ''}`,
      brand, variant: variant.name, meta: { rule: 'design-non-text', source: 'design', impact: 'serious' }, extra: best });
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
      if (ch.meta?.rule !== 'design-contrast' && ch.meta?.rule !== 'design-non-text') continue;
      for (const i of ch.instances) if (i.extra) designIndex.set(`${ch.meta.rule}|${c.key}|${i.brand}|${i.variant}`, i.extra);
    }
  }
  for (const c of components) {
    for (const ch of c.checks) {
      const m = ch.meta;
      if (!m) continue;
      if (m.rule === 'scan') { scans += ch.instances.length; ch.instances.forEach((i) => i.brand && brands.add(i.brand)); [...AXE_COVERS, ...ch.instances.flatMap((i) => i.extra?.covers ?? []).filter((sc) => !PAGE_LEVEL.has(sc))].forEach((sc) => { if (!tested.has(sc)) tested.set(sc, 'pass'); }); continue; }
      const info = ruleInfo(m.rule, m.tags);
      if (m.rule === 'design-contrast' || m.rule === 'design-non-text') designChecks += ch.instances.length;
      const sc = info.criterion?.sc;
      const st = ch.status === 'ignored' || ch.status === 'info' ? 'pass' : ch.status;
      if (sc) { const prev = tested.get(sc); const rank = { pass: 0, warn: 1, fail: 2 }; if (!prev || rank[st] > rank[prev]) tested.set(sc, st); }
      if (st === 'pass') continue;
      const impact = (m.rule === 'design-contrast' || m.rule === 'design-non-text') && ch.status === 'warn' ? 'moderate' : (m.impact ?? (ch.status === 'fail' ? 'serious' : 'moderate'));
      if (!issues.has(m.rule)) {
        issues.set(m.rule, { items: [], rule: m.rule, criterion: info.criterion, title: info.title ?? ch.title, why: info.why, fix: info.fix, impact, status: ch.status, owner: ch.owner, source: m.source, help: m.source === 'code' && m.rule !== 'keyboard' && m.rule !== 'focus-visible' && m.rule !== 'target-size' ? ch.instances.find((i) => i.code)?.code ?? null : null, components: [], where: [] });
      }
      const it = issues.get(m.rule);
      if (IMPACT[impact] > IMPACT[it.impact]) it.impact = impact;
      if (ch.status === 'fail') it.status = 'fail';
      if (!it.components.some((x) => x.key === c.key)) it.components.push({ name: c.name, key: c.key });
      it.items.push({ component: c.key, key: ch.key, title: ch.title, componentName: c.name });
      const groups = new Map();
      for (const i of ch.instances.filter((x) => x.status !== 'pass')) {
        const k = `${i.brand ?? ''}`;
        if (!groups.has(k)) groups.set(k, { checkKey: ch.key, title: ch.title, component: c.name, componentKey: c.key, brand: i.brand, variants: [], status: i.status, detail: i.detail, contrast: null, design: null, target: i.extra?.target ?? null, size: i.extra?.w ? { w: i.extra.w, h: i.extra.h, min: i.extra.min } : null });
        const g = groups.get(k);
        if (i.variant && !g.variants.includes(i.variant)) g.variants.push(i.variant);
        if (i.status === 'fail') g.status = 'fail';
        if (i.extra?.ratio && (!g.contrast || i.extra.ratio < g.contrast.ratio)) {
          g.contrast = { ratio: i.extra.ratio, required: i.extra.required, fg: i.extra.fg, bg: i.extra.bg, fgToken: i.extra.fgToken ?? null, bgToken: i.extra.bgToken ?? null, assumed: !!i.extra.assumed, variant: i.variant };
          const dr = { 'color-contrast': 'design-contrast', 'non-text-contrast': 'design-non-text' }[m.rule];
          if (dr) g.design = designIndex.get(`${dr}|${c.key}|${i.brand}|${i.variant}`) ?? null;
        }
      }
      it.where.push(...groups.values());
    }
  }
  // Who fixes code contrast: if Figma fails too, it starts in the design
  for (const it of issues.values()) {
    if (it.rule !== 'color-contrast' && it.rule !== 'non-text-contrast') continue;
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
  const bySc = (a, b) => a.sc.localeCompare(b.sc, undefined, { numeric: true });
  const criteria = [...tested.entries()].filter(([sc]) => CRITERIA[sc]).map(([sc, status]) => ({ sc, ...CRITERIA[sc], status, issues: list.filter((i) => i.criterion?.sc === sc).length })).sort(bySc);
  // Everything at A and AA that wasn't tested here, so nobody mistakes the automated result for full AA
  const manual = Object.entries(CRITERIA).filter(([sc]) => !tested.has(sc)).map(([sc, c]) => ({ sc, name: c.name, level: c.level, url: c.url })).sort(bySc);
  return {
    ran: scans > 0 || designChecks > 0, scans, designChecks, brands: [...brands], counts, total: list.length,
    components: new Set(list.flatMap((i) => i.components.map((c) => c.key))).size,
    byBrand, criteria, manual, coverage: { tested: criteria.length, total: Object.keys(CRITERIA).length }, issues: list,
  };
}

// ---------------------------------------------------------------- AA checks axe doesn't make (from src/page/aa.js)
const A = (checks, subject, label, rule, status, title, extra = {}) =>
  checks.add({ category: 'Accessibility', subject, label, status, owner: extra.owner ?? 'Dev', title, detail: extra.detail ?? null, brand: extra.brand, variant: extra.variant,
    meta: { rule, source: extra.source ?? 'code', impact: extra.impact ?? (status === 'fail' ? 'serious' : status === 'warn' ? 'moderate' : undefined) }, extra: extra.extra ?? null });

/** Per rendered variant: 1.4.11 non-text contrast and 2.5.3 label in name. */
export function aaQuickChecks(checks, { result, brand, variant }) {
  if (!result || result.error) return;
  const ctx = { brand, variant };
  const nt = result.nonText ?? [];
  const n = result.counts ?? {};
  if (n.fields || n.icons || nt.length) {
    if (!nt.length) A(checks, 'aa:non-text', 'Non-text contrast', 'non-text-contrast', 'pass', 'Field edges and icons reach 3:1', ctx);
    for (const f of nt) {
      A(checks, 'aa:non-text', 'Non-text contrast', 'non-text-contrast', 'fail', f.kind === 'field' ? 'Field edge is hard to see' : 'Icon-only control is hard to see',
        { ...ctx, detail: `${f.ratio}:1, needs 3:1 · ${f.part === 'none' ? 'no border or fill' : f.part} ${f.fg} on ${f.bg} · ${f.target}`, extra: { ratio: f.ratio, required: 3, fg: f.fg, bg: f.bg, target: f.target } });
    }
  }
  const lab = result.labels ?? [];
  if (n.named || lab.length) {
    if (!lab.length) A(checks, 'aa:label-in-name', 'Label in name', 'label-in-name', 'pass', 'Spoken names include the visible labels', ctx);
    for (const l of lab) A(checks, 'aa:label-in-name', 'Label in name', 'label-in-name', 'fail', "Spoken name doesn't match the visible label",
      { ...ctx, impact: 'serious', detail: `Shows "${l.visible}" but is announced as "${l.name}" · ${l.target}`, extra: { target: l.target } });
  }
}

/** Once per component: keyboard walk (2.1.1, 2.1.2, 2.4.7, 2.4.11) and layout stress (1.4.4, 1.4.10, 1.4.12). */
export function aaFullChecks(checks, { result, brand, variant }) {
  if (!result || result.error) return;
  const ctx = { brand, variant };
  const k = result.kbd;
  if (k && k.items?.length) {
    // The first interactive element is already covered by the focus probe; these are the rest
    const others = k.items.filter((i) => !i.primary);
    const real = others.filter((i) => !i.pointerOnly);
    const missed = real.filter((i) => !i.reached);
    if (real.length) {
      if (!missed.length) A(checks, 'aa:keyboard-all', 'Keyboard', 'keyboard', 'pass', 'Every control can be reached with the keyboard', ctx);
      for (const i of missed) A(checks, 'aa:keyboard-all', 'Keyboard', 'keyboard', 'fail', "A control can't be reached with the keyboard",
        { ...ctx, impact: 'critical', detail: `${i.text ? `"${i.text}" ` : ''}${i.target} never receives focus when tabbing`, extra: { target: i.target } });
    }
    for (const i of others.filter((x) => x.pointerOnly && !x.reached)) A(checks, 'aa:pointer-only', 'Keyboard', 'pointer-only', 'warn', 'Looks clickable but the keyboard skips it',
      { ...ctx, detail: `${i.text ? `"${i.text}" ` : ''}${i.target} has a pointer cursor but can't take focus`, extra: { target: i.target } });
    A(checks, 'aa:keyboard-trap', 'No keyboard trap', 'keyboard-trap', k.trapped ? 'fail' : 'pass', k.trapped ? 'Keyboard focus gets stuck' : 'Keyboard focus can leave the component',
      { ...ctx, impact: 'critical', detail: k.trapped ? 'Pressing Tab keeps focus inside the component' : null });
    const reached = others.filter((i) => i.reached);
    for (const i of reached) {
      A(checks, 'aa:focus-visible-all', 'Focus visible', 'focus-visible', i.visible ? 'pass' : 'fail', i.visible ? 'Every control shows focus' : 'A control shows no focus indicator',
        { ...ctx, detail: i.visible ? null : `${i.text ? `"${i.text}" ` : ''}${i.target} looks the same with keyboard focus`, extra: { target: i.target } });
    }
    const all = k.items.filter((i) => i.reached);
    if (all.length) {
      const hidden = all.filter((i) => i.obscured);
      if (!hidden.length) A(checks, 'aa:focus-obscured', 'Focus not obscured', 'focus-obscured', 'pass', 'Focused controls stay visible', ctx);
      for (const i of hidden) A(checks, 'aa:focus-obscured', 'Focus not obscured', 'focus-obscured', 'fail', 'Focused control is hidden behind something',
        { ...ctx, detail: `${i.target} is fully covered when it has focus`, extra: { target: i.target } });
    }
  }
  const L = result.layout ?? {};
  const layout = (kind, subject, label, rule, okTitle, badTitle, what) => {
    const r = L[kind];
    if (!r || r.error) return;
    const bad = r.clippedCount > 0 || !!r.overflow;
    const bits = [];
    if (r.overflow) bits.push(`needs ${r.overflow.width}px at ${r.overflow.viewport}px wide`);
    if (r.clippedCount) bits.push(`${r.clippedCount} text ${r.clippedCount === 1 ? 'element is' : 'elements are'} cut off: ${r.clipped.map((c) => `"${c.text}"`).join(', ')}`);
    A(checks, subject, label, rule, bad ? 'fail' : 'pass', bad ? badTitle : okTitle, { ...ctx, owner: 'Both', detail: bad ? `${what}: ${bits.join('; ')}` : null, extra: r.clipped?.[0] ? { target: r.clipped[0].target } : null });
  };
  layout('text', 'aa:resize-text', 'Resize text', 'resize-text', 'Nothing is cut off at 200% text', 'Text gets cut off at 200% size', 'At 200% text');
  layout('spacing', 'aa:text-spacing', 'Text spacing', 'text-spacing', 'Nothing is cut off with wider text spacing', 'Text gets cut off with wider spacing', 'With WCAG text spacing');
  layout('reflow', 'aa:reflow', 'Reflow', 'reflow', 'Fits a 320px-wide screen', "Doesn't fit a 320px-wide screen", 'At 320px wide');
}
