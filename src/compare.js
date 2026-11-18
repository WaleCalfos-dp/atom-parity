// Turns raw Figma + Storybook data into pass / warn / fail checks.
import { norm, parseColor, colorDistance, colorToHex, px, firstFontFamily, figmaVarToCss, cssNameInfo, isColorLiteral } from './util.js';
import { SEMANTIC_VALUES } from './match.js';

export const CATEGORIES = ['Naming', 'Properties', 'Tokens', 'Visual', 'Accessibility', 'Interaction', 'Rendering', 'Documentation'];
const RANK = { pass: 0, info: 0, warn: 1, fail: 2 };
const USER_FACING = new Set(['Visual', 'Accessibility', 'Interaction', 'Rendering']);

// ---------------------------------------------------------------- check collection
export class Checks {
  constructor() { this.map = new Map(); }
  add(c) {
    const key = `${c.category}|${c.subject}`;
    const inst = { status: c.status, brand: c.brand ?? null, variant: c.variant ?? null, detail: c.detail ?? null, figma: c.figma ?? null, code: c.code ?? null, image: c.image ?? null, extra: c.extra ?? null };
    const prev = this.map.get(key);
    if (!prev) {
      this.map.set(key, { key, category: c.category, subject: c.subject, label: c.label ?? c.subject, status: c.status, title: c.title, owner: c.owner ?? null, detail: c.detail ?? null, meta: c.meta ?? null, instances: [inst] });
      return;
    }
    prev.instances.push(inst);
    if (!prev.meta && c.meta) prev.meta = c.meta;
    if (RANK[c.status] > RANK[prev.status]) { prev.status = c.status; prev.title = c.title; prev.owner = c.owner ?? prev.owner; prev.detail = c.detail ?? prev.detail; }
  }
  list() {
    return [...this.map.values()].map((c) => {
      const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
      c.instances.forEach((i) => { counts[i.status]++; });
      const bad = c.instances.filter((i) => i.status === c.status && c.status !== 'pass');
      return {
        ...c,
        counts,
        brands: [...new Set(bad.map((i) => i.brand).filter(Boolean))],
        variants: [...new Set(bad.map((i) => i.variant).filter(Boolean))],
        instances: [...c.instances].sort((a, b) => RANK[b.status] - RANK[a.status]).slice(0, 80),
      };
    });
  }
}

export function scoreOf(checks) {
  const scored = checks.filter((c) => c.status !== 'info' && c.status !== 'ignored');
  if (!scored.length) return null;
  const pts = scored.reduce((s, c) => s + (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
  return Math.round((pts / scored.length) * 100);
}

export function statusOf(checks) {
  if (checks.some((c) => c.status === 'fail' && USER_FACING.has(c.category))) return 'Broken';
  if (checks.some((c) => c.status === 'fail' || c.status === 'warn')) return 'Drifted';
  return 'Aligned';
}

// ---------------------------------------------------------------- labels
const LABEL = {
  'background-color': 'Background colour', color: 'Text colour', 'border-top-color': 'Border colour', 'border-top-width': 'Border width',
  'border-top-left-radius': 'Corner radius', 'padding-left': 'Horizontal padding', 'padding-top': 'Vertical padding',
  'column-gap': 'Gap between items', 'row-gap': 'Gap between items', height: 'Height', 'font-size': 'Font size',
  'font-weight': 'Font weight', 'font-family': 'Font family', 'line-height': 'Line height', opacity: 'Opacity',
};

// Figma layer field → CSS property, with how to read the Figma value
const ROOT_PAIRS = [
  { css: 'background-color', bind: ['fills'], raw: 'fills', kind: 'color' },
  { css: 'border-top-color', bind: ['strokes'], raw: 'strokes', kind: 'color', when: (l) => (l.raw.strokeWeight ?? 0) > 0 && l.raw.strokes },
  { css: 'border-top-width', bind: ['strokeTopWeight', 'strokeWeight'], raw: ['strokeTopWeight', 'strokeWeight'], kind: 'px', when: (l) => l.raw.strokes && (l.raw.strokeWeight ?? 0) > 0 },
  { css: 'border-top-left-radius', bind: ['topLeftRadius', 'cornerRadius'], raw: ['topLeftRadius', 'cornerRadius'], kind: 'radius' },
  { css: 'padding-left', bind: ['paddingLeft'], raw: 'paddingLeft', kind: 'px', when: (l) => l.raw.layoutMode && l.raw.layoutMode !== 'NONE' },
  { css: 'padding-top', bind: ['paddingTop'], raw: 'paddingTop', kind: 'px', when: (l) => l.raw.layoutMode && l.raw.layoutMode !== 'NONE' },
  { css: 'column-gap', bind: ['itemSpacing'], raw: 'itemSpacing', kind: 'gap', when: (l) => l.raw.layoutMode === 'HORIZONTAL' },
  { css: 'row-gap', bind: ['itemSpacing'], raw: 'itemSpacing', kind: 'gap', when: (l) => l.raw.layoutMode === 'VERTICAL' },
  { css: 'height', bind: ['height'], raw: 'height', kind: 'px', when: (l) => l.raw.layoutSizingVertical === 'FIXED' || !l.raw.layoutSizingVertical },
  { css: 'opacity', bind: ['opacity'], raw: 'opacity', kind: 'number', when: (l) => (l.raw.opacity ?? 1) < 1 },
];
const TEXT_PAIRS = [
  { css: 'color', bind: ['fills'], raw: 'fills', kind: 'color' },
  { css: 'font-size', bind: ['fontSize'], raw: 'fontSize', kind: 'px' },
  { css: 'font-weight', bind: ['fontWeight', 'fontStyle'], raw: 'fontWeight', kind: 'weight' },
  { css: 'font-family', bind: ['fontFamily'], raw: 'fontFamily', kind: 'family' },
  { css: 'line-height', bind: ['lineHeight'], raw: 'lineHeight', kind: 'px', when: (l) => typeof l.raw.lineHeight === 'number' },
];

function figmaRaw(layer, raw) {
  const keys = Array.isArray(raw) ? raw : [raw];
  for (const k of keys) if (layer.raw[k] !== undefined && layer.raw[k] !== null) return layer.raw[k];
  return null;
}
function figmaBinding(layer, keys, variables) {
  for (const k of keys) {
    const id = layer.bindings?.[k]?.[0];
    if (id && variables[id]?.name) return variables[id];
  }
  return null;
}

function valuesEqual(kind, design, code, tol) {
  if (design === null || design === undefined || code === null || code === undefined || code === '') return null;
  switch (kind) {
    case 'color': return colorDistance(design, code) <= tol.color;
    case 'px': case 'gap': { const c = px(code); return c === null ? null : Math.abs(Number(design) - c) <= tol.px; }
    case 'radius': { const c = px(code); if (c === null) return null; const d = Number(design); return d >= 99 && c >= 99 ? true : Math.abs(d - c) <= tol.px; }
    case 'number': return Math.abs(Number(design) - Number(code)) <= 0.02;
    case 'weight': return Number(design) === Number(code);
    case 'family': return norm(firstFontFamily(design)) === norm(firstFontFamily(code));
    default: return String(design) === String(code);
  }
}

function fmt(kind, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (kind === 'color') { const c = parseColor(v); return c ? colorToHex(c) : String(v); }
  if (kind === 'px' || kind === 'gap' || kind === 'radius') { const n = px(v); return n === null ? String(v) : `${Math.round(n * 100) / 100}px`; }
  return String(v);
}

// ---------------------------------------------------------------- per-render token checks
export function tokenChecks(checks, { variant, figmaBrand, codeBrand, dom, variables, cfg, definedTokens, hasVisual, defaultBrand }) {
  const root = variant.layers?.[0];
  if (!root || !dom?.elements?.length) return;
  const textLayer = variant.layers.find((l) => l.type === 'TEXT' && l.raw.fontSize);
  const codeRoot = dom.elements[0];
  const codeText = dom.textIndex >= 0 ? dom.elements[dom.textIndex] : null;
  const tol = cfg.tokens.tolerance;
  const prefix = cfg.tokens.cssVarPrefix;
  const ctx = { brand: figmaBrand, variant: variant.name };

  const run = (pairs, layer, el, where) => {
    if (!layer || !el) return;
    for (const p of pairs) {
      if (p.when && !p.when(layer)) continue;
      const v = figmaBinding(layer, p.bind, variables);
      // Linked to a variable we can't name (REST on Pro without a plugin snapshot): compare values only
      const boundUnknown = !v && p.bind.some((k) => layer.bindings?.[k]?.length);
      if (boundUnknown && defaultBrand && figmaBrand !== defaultBrand) continue; // per-brand value unknown without token data
      const designValue = v ? (v.valuesByBrand?.[figmaBrand] ?? figmaRaw(layer, p.raw)) : figmaRaw(layer, p.raw);
      if (designValue === null || designValue === undefined) continue;
      const codeValue = el.styles[p.css];
      const label = `${where}${LABEL[p.css] ?? p.css}`;
      const tokenLabel = v ? `${v.name}` : boundUnknown ? 'linked variable' : 'no variable';

      // Value
      const numeric = p.kind === 'px' || p.kind === 'gap' || p.kind === 'radius';
      const skipValue =
        (p.kind === 'gap' && (codeValue === 'normal' || px(codeValue) === 0) && !el.vars[p.css]) || // spacing done with margins can't be read reliably
        (p.css.startsWith('padding') && !v && Number(designValue) === 0) ||                       // padding usually lives on a nested layer instead
        (p.css === 'height' && hasVisual);                                                          // the visual check measures height
      if (!skipValue) {
        const eq = valuesEqual(p.kind, designValue, codeValue, tol);
        if (eq !== null) {
          // Guidelines before enforcement: raw (unlinked) spacing and sizes warn; token-bound values must match.
          const missStatus = numeric && !v && !boundUnknown ? 'warn' : 'fail';
          checks.add({ category: 'Tokens', subject: `value:${label}`, label, status: eq ? 'pass' : missStatus, owner: 'Both',
            title: eq ? `${label} matches design` : `${label} differs from design`,
            detail: `Design ${fmt(p.kind, designValue)} (${tokenLabel}) · Code ${fmt(p.kind, codeValue)}`,
            figma: fmt(p.kind, designValue), code: fmt(p.kind, codeValue), ...ctx });
        }
      }

      // Token linkage
      const chain = (el.vars[p.css] ?? []).filter((n) => n.startsWith(prefix));
      if (v) {
        const info = cssNameInfo(v, cfg.tokens);
        const expected = info.css;
        if (chain.includes(expected) && info.renamed) {
          checks.add({ category: 'Tokens', subject: `token:${label}`, label, status: 'warn', owner: 'Both', title: `${label} uses the design token under a different name`, detail: `${v.name} is ${expected} in code (convention: ${info.conventional})`, figma: v.name, code: expected, ...ctx });
        } else if (chain.includes(expected)) {
          checks.add({ category: 'Tokens', subject: `token:${label}`, label, status: 'pass', owner: 'Both', title: `${label} uses the design token`, detail: `${v.name} → ${expected}`, ...ctx });
        } else if (chain.length) {
          const exists = definedTokens?.has(expected);
          checks.add({ category: 'Tokens', subject: `token:${label}`, label, status: 'warn', owner: 'Both',
            title: `${label} uses a different token`,
            detail: `Design token ${v.name} (${expected}${exists ? '' : ', not defined in code'}) · Code uses ${chain[chain.length - 1]}${chain.length > 1 ? ` via ${chain.slice(0, -1).join(' → ')}` : ''}`,
            figma: expected, code: chain[chain.length - 1], ...ctx });
        } else if (el.literals[p.css] && isColorLiteral(el.literals[p.css])) {
          checks.add({ category: 'Tokens', subject: `token:${label}`, label, status: 'fail', owner: 'Dev',
            title: `${label} is hard-coded in code`,
            detail: `Design uses ${v.name} (${expected}) · Code sets ${fmt('color', el.literals[p.css])}`, figma: expected, code: fmt('color', el.literals[p.css]), ...ctx });
        }
      } else if (boundUnknown) {
        // can't name the token without a plugin snapshot; value check above still runs
      } else if (p.kind === 'color' || p.kind === 'radius') {
        if (p.kind === 'radius' && Number(designValue) === 0) continue;
        checks.add({ category: 'Tokens', subject: `token:${label}`, label, status: 'warn', owner: 'Design',
          title: `${label} isn't linked to a variable in Figma`,
          detail: `Figma layer "${layer.name}" uses a raw ${fmt(p.kind, designValue)}${chain.length ? ` · Code uses ${chain[chain.length - 1]}` : ''}`, figma: fmt(p.kind, designValue), code: chain[chain.length - 1] ?? null, ...ctx });
      }
    }
  };
  run(ROOT_PAIRS, root, codeRoot, '');
  run(TEXT_PAIRS, textLayer, codeText, 'Label · ');
}

// ---------------------------------------------------------------- visual
export function visualChecks(checks, { variant, figmaBrand, vis, cfg, images, sizing, hasText, caveats = [] }) {
  const t = cfg.visual.thresholds;
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  let status = vis.mismatch <= t.pass ? 'pass' : vis.mismatch <= t.warn ? 'warn' : 'fail';
  // When Figma shows parts the story can't (icons switched on by default), a pixel gap is expected: never "broken" on that alone
  if (status === 'fail' && caveats.length) status = 'warn';
  checks.add({ category: 'Visual', subject: 'pixels', label: 'Appearance', status, owner: 'Both',
    title: status === 'pass' ? 'Looks the same as design' : status === 'warn' ? 'Visual differences' : 'Looks different from design',
    detail: `${pct(vis.mismatch)} of pixels differ${caveats.length && vis.mismatch > t.pass ? `. Figma shows ${caveats.join(' and ')} by default and the story doesn't, so some difference is expected; compare the pictures` : ''}`, brand: figmaBrand, variant: variant.name, image: images, figma: pct(vis.mismatch) });

  const tol = cfg.visual.sizeTolerancePx;
  const dh = Math.abs(vis.sizeDelta.h);
  // Off by a pixel or two is drift; more than 4px or 15% of the height is something people notice.
  const hStatus = dh <= tol ? 'pass' : (dh > 4 || dh / Math.max(1, vis.figmaSize.h) > 0.15) ? 'fail' : 'warn';
  checks.add({ category: 'Visual', subject: 'height', label: 'Height', status: hStatus, owner: 'Both',
    title: dh <= tol ? 'Height matches design' : 'Height differs from design',
    detail: `Design ${vis.figmaSize.h}px · Code ${vis.codeSize.h}px`, brand: figmaBrand, variant: variant.name, figma: `${vis.figmaSize.h}px`, code: `${vis.codeSize.h}px` });
  if (sizing?.h !== 'FILL') {
    const dw = Math.abs(vis.sizeDelta.w);
    checks.add({ category: 'Visual', subject: 'width', label: 'Width', status: dw <= Math.max(tol, vis.figmaSize.w * 0.04) ? 'pass' : 'warn', owner: 'Both',
      title: dw <= Math.max(tol, vis.figmaSize.w * 0.04) ? 'Width matches design' : 'Width differs from design',
      detail: `Design ${vis.figmaSize.w}px · Code ${vis.codeSize.w}px${hasText ? ' (label text may differ)' : ''}`, brand: figmaBrand, variant: variant.name, figma: `${vis.figmaSize.w}px`, code: `${vis.codeSize.w}px` });
  }
}

// ---------------------------------------------------------------- accessibility
export function a11yChecks(checks, { result, brand, variant, cfg }) {
  if (!result || result.error) return;
  const designRules = new Set(cfg.a11y.designRules);
  for (const v of result.violations) {
    const serious = v.impact === 'serious' || v.impact === 'critical';
    const extra = v.id === 'color-contrast' ? parseAxeContrast(v.summary) : null;
    checks.add({ category: 'Accessibility', subject: `axe:${v.id}`, label: v.help, status: serious ? 'fail' : 'warn', owner: designRules.has(v.id) ? 'Design' : 'Dev',
      title: v.help, detail: `${v.impact} · ${v.nodes} element${v.nodes === 1 ? '' : 's'} · ${v.target}${v.summary ? ` · ${v.summary.replace(/\s+/g, ' ')}` : ''}`,
      code: v.helpUrl, brand, variant, meta: { rule: v.id, impact: v.impact, tags: v.tags ?? [], source: 'code' }, extra: extra ? { ...extra, target: v.target, nodes: v.nodes } : { target: v.target, nodes: v.nodes, impact: v.impact } });
  }
  checks.add({ category: 'Accessibility', subject: 'axe', label: 'Automated WCAG 2.2 AA scan', status: 'pass', owner: 'Dev', title: 'Automated scan ran', detail: `${result.violations.length} rule${result.violations.length === 1 ? '' : 's'} failed`, brand, variant, meta: { rule: 'scan', source: 'code' } });
}
export function parseAxeContrast(summary) {
  const s = String(summary ?? '');
  const ratio = s.match(/contrast of ([\d.]+)/i);
  const fg = s.match(/foreground colou?r: (#[0-9a-f]{3,8})/i);
  const bg = s.match(/background colou?r: (#[0-9a-f]{3,8})/i);
  const req = s.match(/contrast ratio of ([\d.]+):1/i);
  const size = s.match(/\((\d+(?:\.\d+)?)px\)/);
  const weight = s.match(/font weight: (\w+)/i);
  if (!ratio) return null;
  return { ratio: Number(ratio[1]), fg: fg?.[1] ?? null, bg: bg?.[1] ?? null, required: req ? Number(req[1]) : 4.5, size: size ? Number(size[1]) : null, weight: weight?.[1] ?? null };
}

// ---------------------------------------------------------------- interaction
const changed = (a, b, keys) => keys.some((k) => (a?.[k] ?? '') !== (b?.[k] ?? ''));
export function interactionChecks(checks, { probe, designHasHover, designHasFocus, cfg, brand }) {
  if (!probe || probe.disabled) return;
  const { rest, hover, focus, targetRect } = probe;
  if (cfg.interaction.minTargetSize && targetRect) {
    const ok = Math.min(targetRect.w, targetRect.h) >= cfg.interaction.minTargetSize;
    checks.add({ category: 'Interaction', subject: 'target', label: 'Touch target', status: ok ? 'pass' : 'fail', owner: 'Both',
      title: ok ? `Touch target is at least ${cfg.interaction.minTargetSize}px` : `Touch target is smaller than ${cfg.interaction.minTargetSize}px`,
      detail: `${targetRect.w} × ${targetRect.h}px`, brand, meta: { rule: 'target-size', source: 'code', impact: 'serious' }, extra: { w: targetRect.w, h: targetRect.h, min: cfg.interaction.minTargetSize } });
  }
  if (!focus) {
    checks.add({ category: 'Interaction', subject: 'focus', label: 'Keyboard focus', status: 'fail', owner: 'Dev', title: "Can't be reached with the keyboard", detail: 'Tabbing through the story never lands on the component', brand, meta: { rule: 'keyboard', source: 'code', impact: 'critical' } });
  } else {
    const ringKeys = ['outline-style', 'outline-width', 'outline-color', 'box-shadow', 'border-top-color', 'border-top-width', 'background-color', '::before outline', '::before border', '::before box-shadow', '::after outline', '::after border', '::after box-shadow'];
    const visible = (focus['outline-style'] !== 'none' && parseFloat(focus['outline-width']) > 0) || changed(rest, focus, ringKeys.filter((k) => !k.startsWith('outline')));
    checks.add({ category: 'Interaction', subject: 'focus', label: 'Focus indicator', status: visible ? 'pass' : 'fail', owner: designHasFocus ? 'Dev' : 'Both',
      title: visible ? 'Visible focus indicator' : 'No visible focus indicator',
      detail: visible ? `Focus style: outline ${focus['outline-style']} ${focus['outline-width']}${focus['box-shadow'] !== 'none' ? `, shadow ${focus['box-shadow'].slice(0, 60)}` : ''}` : `Nothing changes when the component receives keyboard focus${designHasFocus ? ' (Figma has a Focus state)' : ''}`, brand, meta: { rule: 'focus-visible', source: 'code', impact: 'serious' } });
  }
  if (designHasHover) {
    const hoverChanged = hover && changed(rest, hover, ['background-color', 'color', 'border-top-color', 'box-shadow', 'text-decoration-line', 'opacity']);
    checks.add({ category: 'Interaction', subject: 'hover', label: 'Hover state', status: hoverChanged ? 'pass' : 'warn', owner: 'Dev',
      title: hoverChanged ? 'Hover style present' : 'No hover style in code',
      detail: hoverChanged ? `Background ${rest['background-color']} → ${hover['background-color']}` : 'Figma has a Hover state but nothing changes on hover', brand });
  }
}

// ---------------------------------------------------------------- properties & naming
export function propertyChecks(checks, { pair, propMatch, codeComp, cfg }) {
  const retired = cfg.naming.retired ?? {};
  for (const p of propMatch.props) {
    const label = `Property "${p.figma}"`;
    if (p.how === 'ignored') continue;
    if (p.how === 'state') {
      const missing = p.values.filter((v) => v.how === 'missing').map((v) => v.figma);
      const semantic = p.values.filter((v) => SEMANTIC_VALUES.has(norm(v.figma))).map((v) => v.figma);
      checks.add({ category: 'Properties', subject: `prop:${p.figma}`, label, status: missing.length ? 'warn' : 'pass', owner: 'Dev',
        title: missing.length ? `${p.figma} values with no code equivalent: ${missing.join(', ')}` : `${p.figma} states map to code`,
        detail: p.values.map((v) => `${v.figma} → ${v.how === 'interaction' ? `:${v.interaction ?? 'rest'}` : v.how === 'boolean' ? `${v.boolArg}=true` : v.how === 'enum' ? `${v.arg}="${v.code}"` : 'missing'}`).join(' · ') });
      if (semantic.length) {
        checks.add({ category: 'Naming', subject: `taxonomy:${p.figma}`, label: `${label} taxonomy`, status: 'fail', owner: 'Design',
          title: `Semantic values live under "${p.figma}"`, detail: `${semantic.join(', ')} are semantic types, not interactive states. Use a "Type" property for them.` });
      }
      continue;
    }
    if (p.how === 'missing') {
      const soft = p.figmaType === 'TEXT' || p.figmaType === 'INSTANCE_SWAP';
      checks.add({ category: 'Properties', subject: `prop:${p.figma}`, label, status: soft ? 'warn' : 'fail', owner: 'Dev',
        title: `Figma property "${p.figma}" has no equivalent in code`, detail: p.options.length ? `Values: ${p.options.join(', ')}` : `${p.figmaType.toLowerCase()} property` });
      continue;
    }
    const sameName = norm(p.figma) === norm(p.codeArg) || p.how === 'convention';
    checks.add({ category: 'Naming', subject: `prop:${p.figma}`, label, status: sameName ? 'pass' : (p.how === 'config' || p.how === 'similar') ? 'warn' : 'fail', owner: 'Both',
      title: p.how === 'convention' ? `"${p.figma}" is the component's children in code` : sameName ? `"${p.figma}" matches "${p.codeArg}"` : `Figma "${p.figma}" is "${p.codeArg}" in code`,
      detail: sameName ? null : p.how === 'similar' ? 'Same words in a different order or form. Align the names so they map 1:1.' : `Rename one side so names match 1:1${p.how === 'inferred' ? ' (paired by matching values)' : ''}` });

    if (p.figmaType === 'VARIANT' && p.values.length) {
      const missing = p.values.filter((v) => v.how === 'missing');
      const renamed = p.values.filter((v) => v.how === 'config');
      const extra = p.codeOnlyValues ?? [];
      const status = missing.length ? 'fail' : (renamed.length || extra.length) ? 'warn' : 'pass';
      const parts = [];
      if (missing.length) parts.push(`Missing in code: ${missing.map((m) => m.figma + (m.suggestion ? ` (closest: ${m.suggestion})` : '')).join(', ')}`);
      if (renamed.length) parts.push(`Named differently: ${renamed.map((r) => `${r.figma} → ${r.code}`).join(', ')}`);
      if (extra.length) parts.push(`Only in code: ${extra.join(', ')}`);
      checks.add({ category: 'Properties', subject: `values:${p.figma}`, label: `${p.figma} values`, status, owner: missing.length || renamed.length ? 'Both' : extra.length ? 'Design' : 'Both',
        title: status === 'pass' ? `All ${p.figma} values match` : missing.length ? `${p.figma} values missing in code` : `${p.figma} values differ`,
        detail: parts.join(' · ') || p.values.map((v) => v.figma).join(', '), figma: p.options.join(', '), code: (p.codeOptions ?? []).join(', ') });
    }
    if (p.default !== undefined && p.codeDefault !== undefined && p.codeDefault !== null && p.figmaType === 'VARIANT') {
      const fv = p.values.find((v) => v.figma === p.default);
      const want = fv?.code ?? p.default;
      const got = String(p.codeDefault).replace(/^["']|["']$/g, '');
      const ok = norm(want) === norm(got);
      checks.add({ category: 'Properties', subject: `default:${p.figma}`, label: `${p.figma} default`, status: ok ? 'pass' : 'warn', owner: 'Both',
        title: ok ? `Default ${p.figma} matches` : `Default ${p.figma} differs`, detail: `Design ${p.default} · Code ${got}` });
    }
    if (p.codeArg && /^(state|status)$/i.test(p.codeArg) && (p.codeOptions ?? []).some((o) => SEMANTIC_VALUES.has(norm(o)))) {
      checks.add({ category: 'Naming', subject: `taxonomy-code:${p.codeArg}`, label: 'Code prop taxonomy', status: 'fail', owner: 'Dev',
        title: `Semantic values live under "${p.codeArg}" in code`, detail: 'Use "type" for semantic values such as success or warning. "state" is for interaction.' });
    }
    if (/^options?$/i.test(p.figma)) {
      checks.add({ category: 'Naming', subject: `option:${p.figma}`, label: 'Property naming', status: 'warn', owner: 'Design', title: `"${p.figma}" is a vague property name`, detail: 'Use "Style" for visual variants and "Type" for semantic ones.' });
    }
    for (const v of p.options) {
      const r = retired[norm(v)];
      if (r) checks.add({ category: 'Naming', subject: `retired:${p.figma}:${v}`, label: 'Retired term', status: 'warn', owner: 'Design', title: `"${v}" is a retired term`, detail: `Use "${r}" instead (${p.figma})` });
    }
  }
  const codeValues = [
    ...propMatch.codeOnly.flatMap((a) => (a.options ?? []).map((o) => ({ arg: a.name, o }))),
    ...propMatch.props.filter((p) => p.codeArg).flatMap((p) => (p.codeOptions ?? []).map((o) => ({ arg: p.codeArg, o }))),
  ];
  for (const v of codeValues) {
    const r = retired[norm(v.o)];
    if (r) checks.add({ category: 'Naming', subject: `retired-code:${v.arg}:${v.o}`, label: 'Retired term', status: 'warn', owner: 'Dev', title: `"${v.o}" is a retired term in code`, detail: `Use "${r}" instead (${v.arg})` });
  }
  const codeOnly = propMatch.codeOnly.map((a) => a.name);
  checks.add({ category: 'Properties', subject: 'code-only', label: 'Code-only props', status: codeOnly.length ? 'warn' : 'pass', owner: 'Design',
    title: codeOnly.length ? `Code has props with no Figma property` : 'Every code prop exists in Figma', detail: codeOnly.length ? codeOnly.join(', ') : null });
}

export function componentNamingChecks(checks, { pair, cfg }) {
  const f = pair.figma; const c = pair.code;
  const exact = norm(f.name) === norm(c.name);
  checks.add({ category: 'Naming', subject: 'name', label: 'Component name', status: exact ? 'pass' : pair.how === 'similar' ? 'warn' : 'fail', owner: 'Both',
    title: exact ? 'Name matches 1:1' : `Figma "${f.name}" is "${c.name}" in Storybook`, detail: exact ? `${f.name} ↔ ${c.title}` : 'Rename one side so any developer can map code to the design system immediately.' });
  const groupMap = Object.fromEntries(Object.entries(cfg.naming.groupMap ?? {}).map(([k, v]) => [norm(k), v]));
  const fGroup = f.section ?? null; const cGroup = c.group ?? null;
  if (fGroup && cGroup) {
    const ok = norm(fGroup) === norm(cGroup) || norm(groupMap[norm(fGroup)] ?? '') === norm(cGroup);
    checks.add({ category: 'Naming', subject: 'group', label: 'Category', status: ok ? 'pass' : 'warn', owner: 'Both',
      title: ok ? 'Grouped under the same category' : 'Grouped under a different category', detail: `Figma "${fGroup}" · Storybook "${cGroup}"` });
  }
  checks.add({ category: 'Documentation', subject: 'docs-code', label: 'Storybook docs', status: c.hasDocs ? 'pass' : 'warn', owner: 'Dev', title: c.hasDocs ? 'Has a Storybook docs page' : 'No Storybook docs page' });
  checks.add({ category: 'Documentation', subject: 'docs-figma', label: 'Figma description', status: (f.description || f.docLinks?.length) ? 'pass' : 'warn', owner: 'Design',
    title: (f.description || f.docLinks?.length) ? 'Has a Figma description' : 'No description in Figma' });
}

// ---------------------------------------------------------------- global token table
export function tokenTable({ manifest, brandPairs, tokenRead, cfg }) {
  const rows = [];
  const tol = cfg.tokens.tolerance;
  const definedSet = new Set(tokenRead?.defined ?? []);
  const retired = cfg.naming.retired ?? {};
  for (const [id, v] of Object.entries(manifest.variables ?? {})) {
    if (!v?.name || !['COLOR', 'FLOAT', 'STRING'].includes(v.resolvedType)) continue;
    const info = cssNameInfo(v, cfg.tokens);
    const css = info.css;
    const retiredSeg = v.name.split('/').flatMap((s) => s.split('-')).map(norm).find((s) => retired[s]);
    const row = { id, figma: v.name, collection: v.collection, css, conventional: info.renamed ? info.conventional : null, type: v.resolvedType, definedInCode: definedSet.has(css), brands: {}, retired: retiredSeg ? `${retiredSeg} → ${retired[retiredSeg]}` : null };
    for (const bp of brandPairs) {
      if (!bp.code) continue;
      const design = v.valuesByBrand?.[bp.figma];
      const vals = tokenRead?.values?.[bp.code] ?? {};
      const raw = vals[css];
      let code = raw ?? null;
      if (code && /rem$/.test(code) && vals.__rootFontSize) code = `${parseFloat(code) * vals.__rootFontSize}px`;
      let status;
      if (code === null) status = 'missing';
      else if (v.resolvedType === 'COLOR') status = colorDistance(design, code) <= tol.color ? 'match' : 'differs';
      else if (v.resolvedType === 'FLOAT') { const c = px(code); status = c !== null && Math.abs(Number(design) - c) <= tol.px ? 'match' : 'differs'; }
      else status = norm(firstFontFamily(design)) === norm(firstFontFamily(code)) ? 'match' : 'differs';
      row.brands[bp.figma] = { design: v.resolvedType === 'COLOR' ? fmt('color', design) : design, code: raw, status };
    }
    const sts = Object.values(row.brands).map((b) => b.status);
    row.status = !sts.length ? 'unknown' : sts.every((s) => s === 'missing') ? 'missing' : sts.some((s) => s !== 'match') ? 'differs' : 'match';
    rows.push(row);
  }
  rows.sort((a, b) => ({ missing: 0, differs: 1, match: 2, unknown: 3 }[a.status] - { missing: 0, differs: 1, match: 2, unknown: 3 }[b.status]) || a.figma.localeCompare(b.figma));
  const count = (s) => rows.filter((r) => r.status === s).length;
  return { rows, summary: { total: rows.length, match: count('match'), differs: count('differs'), missing: count('missing'), unknown: count('unknown'), renamed: rows.filter((r) => r.conventional).length, definedInCode: definedSet.size } };
}

// ---------------------------------------------------------------- baseline delta
export function delta(current, baseline) {
  if (!baseline) return null;
  const idx = (res) => {
    const m = new Map();
    for (const c of res.components) for (const ch of c.checks) m.set(`${c.key}|${ch.category}|${ch.subject}`, { status: ch.status, component: c.name, title: ch.title, category: ch.category });
    return m;
  };
  const now = idx(current); const before = idx(baseline);
  const newFails = []; const fixed = [];
  for (const [k, v] of now) if (v.status === 'fail' && before.get(k)?.status !== 'fail') newFails.push(v);
  for (const [k, v] of before) if (v.status === 'fail' && now.has(k) && now.get(k).status !== 'fail') fixed.push({ ...v, now: now.get(k).status });
  return { since: baseline.meta?.generatedAt ?? null, previousScore: baseline.summary?.score ?? null, newFails, fixed };
}
