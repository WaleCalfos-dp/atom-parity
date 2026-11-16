// Shared helpers: naming, colours, units, tokens.
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------- naming
/** Compare-friendly form: "Progress Steps", "progress-steps", "ProgressSteps" → "progresssteps" */
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/** Last path segment of a Storybook title or Figma name: "Data Display/Collapse" → "Collapse" */
export const leaf = (s) => String(s ?? '').split('/').map((x) => x.trim()).filter(Boolean).pop() ?? '';

export const kebab = (s) => String(s ?? '')
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/[\s_/.]+/g, '-')
  .replace(/[^a-zA-Z0-9-]/g, '')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '')
  .toLowerCase();

export function levenshtein(a, b) {
  a = norm(a); b = norm(b);
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** 0..1 similarity of two names; handles plurals and containment ("Tags"/"Tag", "Input"/"LabelInput"). */
export function nameSimilarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const sing = (s) => s.replace(/(ies)$/, 'y').replace(/s$/, '');
  if (sing(x) === sing(y)) return 0.95;
  if (x.includes(y) || y.includes(x)) return 0.75;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

// ---------------------------------------------------------------- colours
export function parseColor(input) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
    const a = m[1].includes('/') || parts.length === 4 ? Number(String(m[1].split(/[,/]/).pop()).trim().replace('%', '')) : 1;
    return { r: Math.round(parts[0]), g: Math.round(parts[1]), b: Math.round(parts[2]), a: Number.isFinite(a) ? (a > 1 ? a / 100 : a) : 1 };
  }
  return null;
}

export function colorToHex(c) {
  if (!c) return null;
  const h = (n) => Math.round(n).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a < 0.999 ? h(c.a * 255) : ''}`.toUpperCase();
}

/** Max channel distance, treating fully transparent colours as equal to each other. */
export function colorDistance(a, b) {
  const x = typeof a === 'string' ? parseColor(a) : a;
  const y = typeof b === 'string' ? parseColor(b) : b;
  if (!x || !y) return Infinity;
  if (x.a === 0 && y.a === 0) return 0;
  return Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b), Math.abs(x.a - y.a) * 255);
}

export const isColorLiteral = (v) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(String(v ?? ''));

// ---------------------------------------------------------------- units
export const px = (v) => {
  if (v == null || v === '' || v === 'normal' || v === 'auto') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export const firstFontFamily = (ff) => String(ff ?? '').split(',')[0].replace(/["']/g, '').trim();

// ---------------------------------------------------------------- tokens
/**
 * Expected CSS custom property for a Figma variable.
 * Priority: the variable's own WEB code syntax → config transform.
 * Default transform: strip configured segments, join with "-", add prefix.
 *   "background/interactive/action-hover" → "--aum-background-interactive-action-hover"
 *   "components/button/radius"            → "--aum-button-radius"
 */
export function figmaVarToCss(variable, tokenCfg = {}) {
  return cssNameInfo(variable, tokenCfg)?.css ?? null;
}

/**
 * { css, conventional, renamed }. "conventional" is what the naming convention predicts;
 * "renamed" is true when config (rename or patterns) says code uses another name.
 * Renames are still reported as naming drift, but values get compared.
 */
export function cssNameInfo(variable, tokenCfg = {}) {
  if (!variable?.name) return null;
  const web = variable.codeSyntax?.WEB;
  if (web) {
    const m = web.match(/--[\w-]+/);
    if (m) return { css: m[0], conventional: m[0], renamed: false };
  }
  const strip = new Set((tokenCfg.stripSegments ?? []).map(norm));
  const segs = variable.name.split('/').filter((s) => !strip.has(norm(s)));
  const conventional = `${tokenCfg.cssVarPrefix ?? '--'}${segs.map(kebab).join('-')}`;
  const fix = (n) => (n.startsWith('--') ? n : `--${n}`);
  const explicit = tokenCfg.rename?.[variable.name];
  if (explicit) return { css: fix(explicit), conventional, renamed: fix(explicit) !== conventional };
  for (const p of tokenCfg.patterns ?? []) {
    const re = new RegExp(p.figma);
    if (re.test(variable.name)) { const css = fix(variable.name.replace(re, p.css)); return { css, conventional, renamed: css !== conventional }; }
  }
  return { css: conventional, conventional, renamed: false };
}

export const tokenTail = (name) => String(name ?? '').replace(/^--/, '');

// ---------------------------------------------------------------- io
export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const writeJson = (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2)); };
export const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });
export const slug = (s) => kebab(s).slice(0, 80) || 'x';

export const log = {
  quiet: false,
  info: (...a) => { if (!log.quiet) console.error('·', ...a); },
  step: (...a) => { if (!log.quiet) console.error('\n▸', ...a); },
  warn: (...a) => console.error('!', ...a),
};

export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return results;
}
