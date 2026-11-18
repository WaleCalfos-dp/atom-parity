// Pairs Figma components, properties, values and brands with their Storybook equivalents.
import { norm, leaf, nameSimilarity } from './util.js';

const INTERACTION_VALUES = new Set(['default', 'rest', 'enabled', 'normal', 'idle', 'hover', 'hovered', 'focus', 'focused', 'focusvisible', 'active', 'pressed', 'press']);
const INTERACTION_KIND = { hover: 'hover', hovered: 'hover', focus: 'focus', focused: 'focus', focusvisible: 'focus', active: 'active', pressed: 'active', press: 'active' };
const BOOLEAN_TRUE = new Set(['true', 'on', 'yes']);
const BOOLEAN_FALSE = new Set(['false', 'off', 'no']);
export const SEMANTIC_VALUES = new Set(['success', 'error', 'danger', 'warning', 'info', 'information', 'neutral', 'critical', 'positive', 'negative']);

// ---------------------------------------------------------------- components
export function matchComponents(figmaComps, codeComps, cfg) {
  const aliases = Object.fromEntries(Object.entries(cfg.components?.aliases ?? {}).map(([k, v]) => [norm(k), v]));
  const byNorm = new Map();
  codeComps.forEach((c) => {
    const k = norm(c.name);
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(c);
  });

  const pairs = [];
  const usedCode = new Set();
  const missingInCode = [];

  for (const f of figmaComps) {
    const alias = aliases[norm(f.name)];
    let code = null; let how = null;
    if (alias) {
      code = codeComps.find((c) => norm(c.title) === norm(alias) || norm(c.name) === norm(leaf(alias))) ?? null;
      if (code) how = 'alias';
    }
    if (!code) {
      const exact = byNorm.get(norm(f.name));
      if (exact?.length) { code = exact[0]; how = 'exact'; }
    }
    if (!code && f.name.includes('/') && leaf(f.name).split(/\s+/).length >= 2) {
      // "Flight Delay / Flight Card": the part before the slash is a Figma folder, so match on the last part.
      // Only names of two or more words: a generic word ("Progress Bar / Steps") would pair with an unrelated component.
      const exact = byNorm.get(norm(leaf(f.name)));
      if (exact?.length && !usedCode.has(exact[0].title)) { code = exact[0]; how = 'exact'; }
    }
    if (!code) {
      // Plurals and near-identical spellings ("Tags" ↔ "Tag") are paired automatically, but flagged.
      let best = null; let bestScore = 0;
      for (const c of codeComps) {
        const s = nameSimilarity(f.name, c.name);
        if (s > bestScore) { bestScore = s; best = c; }
      }
      if (best && bestScore >= 0.9) { code = best; how = 'similar'; }
    }
    if (code) { pairs.push({ figma: f, code, how }); usedCode.add(code.title); }
    else missingInCode.push({ figma: f, suggestions: suggest(f.name, codeComps) });
  }

  const missingInDesign = codeComps
    .filter((c) => !usedCode.has(c.title))
    .map((c) => ({ code: c, suggestions: suggest(c.name, missingInCode.map((m) => m.figma)) }));

  return { pairs, missingInCode, missingInDesign };
}

function suggest(name, list) {
  return list
    .map((x) => ({ name: x.name, title: x.title, score: nameSimilarity(name, x.name) }))
    .filter((x) => x.score >= 0.55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// ---------------------------------------------------------------- brands
export function matchBrands(figmaBrands, codeBrands, cfg) {
  const map = cfg.brands?.map ?? {};
  const pairs = []; const usedCode = new Set();
  for (const fb of figmaBrands) {
    let cb = map[fb];
    let how = cb ? 'config' : null;
    if (cb && !codeBrands.some((c) => c.value === cb)) { cb = null; how = null; }
    if (!cb) {
      const hit = codeBrands.find((c) => norm(c.value) === norm(fb) || norm(c.title) === norm(fb));
      if (hit) { cb = hit.value; how = 'exact'; }
    }
    if (!cb) {
      const hit = codeBrands.map((c) => ({ c, s: Math.max(nameSimilarity(fb, c.value), nameSimilarity(fb, c.title)) })).sort((a, b) => b.s - a.s)[0];
      if (hit && hit.s >= 0.8) { cb = hit.c.value; how = 'similar'; }
    }
    if (cb) { pairs.push({ figma: fb, code: cb, how }); usedCode.add(cb); }
    else pairs.push({ figma: fb, code: null, how: 'missing' });
  }
  const onlyInCode = codeBrands.filter((c) => !usedCode.has(c.value)).map((c) => c.value);
  return { pairs, onlyInCode };
}

// ---------------------------------------------------------------- properties
function codeArgList(codeComp, cfg) {
  const ignore = new Set((cfg.props?.ignoreCode ?? []).map(norm));
  return Object.entries(codeComp.argTypes ?? {})
    .filter(([name, at]) => !ignore.has(norm(name)) && !/^on[A-Z]/.test(name) && at?.type !== 'function' && at?.control !== false && !at?.action)
    .map(([name, at]) => ({ name, ...at }));
}

const optionsOf = (arg) => (Array.isArray(arg?.options) ? arg.options.map(String) : []);
const isBooleanArg = (arg) => arg && (arg.type === 'boolean' || arg.control === 'boolean');

function isBooleanish(values) {
  return values.length > 0 && values.length <= 2 && values.every((v) => BOOLEAN_TRUE.has(norm(v)) || BOOLEAN_FALSE.has(norm(v)));
}

function findBoolArg(args, names) {
  for (const n of names) {
    const hit = args.find((a) => isBooleanArg(a) && (norm(a.name) === norm(n) || norm(a.name) === 'is' + norm(n)));
    if (hit) return hit;
  }
  return null;
}

/**
 * Map every Figma property to a Storybook arg.
 * Returns { props: [...], codeOnly: [...] } where each prop is:
 *   { figma, figmaType, options, codeArg, how: exact|config|inferred|state|missing, values: [{ figma, code, how, interaction?, boolArg? }] }
 */
export function matchProps(figmaComp, codeComp, cfg) {
  const args = codeArgList(codeComp, cfg);
  const cfgMap = cfg.props?.map?.[figmaComp.name] ?? {};
  const stateNames = new Set((cfg.props?.statePropNames ?? ['state', 'states', 'interaction']).map(norm));
  const boolStates = cfg.props?.booleanStates ?? {};
  const used = new Set();
  const props = [];

  for (const [propName, def] of Object.entries(figmaComp.properties ?? {})) {
    const options = (def.options ?? []).map(String);
    const entry = { figma: propName, figmaType: def.type, options, default: def.defaultValue, codeArg: null, how: 'missing', values: [] };
    const cfgEntry = cfgMap[propName];
    const cfgArgName = typeof cfgEntry === 'string' ? cfgEntry : cfgEntry?.arg;
    const cfgValues = (typeof cfgEntry === 'object' && cfgEntry?.values) || {};

    if (cfgEntry === false) { entry.how = 'ignored'; props.push(entry); continue; }

    // 1. State-like variant props: split into interaction states, boolean args and real values
    if (def.type === 'VARIANT' && stateNames.has(norm(propName)) && !cfgArgName) {
      entry.how = 'state';
      for (const v of options) {
        const nv = norm(v);
        if (INTERACTION_VALUES.has(nv)) { entry.values.push({ figma: v, how: 'interaction', interaction: INTERACTION_KIND[nv] ?? null }); continue; }
        const boolNames = [boolStates[v], boolStates[nv], v, nv === 'disable' ? 'disabled' : null, nv === 'select' ? 'selected' : null].filter(Boolean);
        const b = findBoolArg(args, boolNames);
        if (b) { entry.values.push({ figma: v, how: 'boolean', boolArg: b.name }); used.add(b.name); continue; }
        // A value of a code enum (e.g. State=Loading ↔ status="loading")
        const enumArg = args.find((a) => optionsOf(a).some((o) => norm(o) === nv));
        if (enumArg) { entry.values.push({ figma: v, how: 'enum', arg: enumArg.name, code: optionsOf(enumArg).find((o) => norm(o) === nv) }); used.add(enumArg.name); continue; }
        entry.values.push({ figma: v, how: 'missing' });
      }
      props.push(entry);
      continue;
    }

    // 2. Find the arg: config → exact name → inferred by value overlap
    let arg = cfgArgName ? args.find((a) => a.name === cfgArgName) : null;
    if (arg) entry.how = 'config';
    if (!arg) { arg = args.find((a) => norm(a.name) === norm(propName)); if (arg) entry.how = 'exact'; }
    if (!arg && def.type === 'VARIANT' && options.length && !isBooleanish(options)) {
      let best = null; let bestOverlap = 0;
      for (const a of args) {
        if (used.has(a.name)) continue;
        const opts = new Set(optionsOf(a).map(norm));
        if (!opts.size) continue;
        const overlap = options.filter((o) => opts.has(norm(o))).length / options.length;
        if (overlap > bestOverlap) { bestOverlap = overlap; best = a; }
      }
      if (best && bestOverlap >= 0.5) { arg = best; entry.how = 'inferred'; }
    }
    if (!arg && (def.type === 'BOOLEAN' || isBooleanish(options))) {
      const b = findBoolArg(args, [propName, propName.replace(/^(show|has|is|with)\s*/i, '')]);
      if (b) { arg = b; entry.how = norm(b.name) === norm(propName) ? 'exact' : 'inferred'; }
    }
    if (!arg && def.type === 'TEXT' && (cfg.props?.textToChildren ?? true)) {
      const textProps = Object.values(figmaComp.properties ?? {}).filter((d) => d.type === 'TEXT').length;
      const all = Object.entries(codeComp.argTypes ?? {});
      const children = all.find(([n]) => n === 'children');
      if (children && (textProps === 1 || /^(label|text|title|content)$/i.test(propName))) { arg = { name: 'children', ...children[1] }; entry.how = 'convention'; }
    }
    if (!arg && (def.type === 'BOOLEAN' || def.type === 'INSTANCE_SWAP')) {
      // "Show Icon Left" ↔ leftIcon: same words once show/has/is/with are dropped
      const words = (n) => n.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !['show', 'has', 'is', 'with', 'enable', 'enabled'].includes(w)).sort().join(' ');
      const target = words(propName);
      const all = Object.entries(codeComp.argTypes ?? {});
      const hit = target && all.find(([n]) => words(n) === target);
      if (hit) { arg = { name: hit[0], ...hit[1] }; entry.how = 'similar'; }
    }
    if (!arg) { props.push(entry); continue; }

    entry.codeArg = arg.name;
    entry.codeType = arg.type;
    entry.codeOptions = optionsOf(arg);
    entry.codeDefault = arg.defaultValue;
    used.add(arg.name);

    if (def.type === 'VARIANT') {
      if (isBooleanish(options) && isBooleanArg(arg)) {
        for (const v of options) entry.values.push({ figma: v, code: BOOLEAN_TRUE.has(norm(v)), how: 'exact' });
      } else {
        const codeOpts = optionsOf(arg);
        for (const v of options) {
          const configured = cfgValues[v];
          if (configured !== undefined) { entry.values.push({ figma: v, code: configured, how: 'config' }); continue; }
          const hit = codeOpts.find((o) => norm(o) === norm(v));
          if (hit !== undefined) entry.values.push({ figma: v, code: hit, how: 'exact' });
          else if (!codeOpts.length) entry.values.push({ figma: v, code: v.toLowerCase(), how: 'free' });
          else entry.values.push({ figma: v, code: null, how: 'missing', suggestion: closest(v, codeOpts) });
        }
        entry.codeOnlyValues = codeOpts.filter((o) => !entry.values.some((x) => x.code !== null && norm(x.code) === norm(o)));
      }
    }
    props.push(entry);
  }

  const codeOnly = args.filter((a) => !used.has(a.name)).map((a) => ({ name: a.name, type: a.type, options: optionsOf(a) }));
  return { props, codeOnly };
}

function closest(v, list) {
  const scored = list.map((o) => ({ o, s: nameSimilarity(v, o) })).sort((a, b) => b.s - a.s);
  return scored[0] && scored[0].s >= 0.5 ? scored[0].o : null;
}

/**
 * Story args + interaction for one Figma variant.
 * Unmapped values are reported back so the caller can skip or flag them.
 */
export function argsForVariant(variant, propMatch) {
  const args = {}; let interaction = null; const unmapped = [];
  for (const p of propMatch.props) {
    const figmaValue = variant.props?.[p.figma];
    if (figmaValue === undefined) continue;
    const v = p.values.find((x) => x.figma === figmaValue);
    if (p.how === 'state') {
      // reset every boolean the State prop controls, then set the active one
      p.values.filter((x) => x.how === 'boolean').forEach((x) => { args[x.boolArg] = false; });
      if (!v || v.how === 'missing') { unmapped.push(`${p.figma}=${figmaValue}`); continue; }
      if (v.how === 'interaction') interaction = v.interaction;
      if (v.how === 'boolean') args[v.boolArg] = true;
      if (v.how === 'enum') args[v.arg] = v.code;
      continue;
    }
    if (!p.codeArg) { if (p.how !== 'ignored') unmapped.push(`${p.figma}=${figmaValue}`); continue; }
    if (!v || v.code === null || v.code === undefined) { unmapped.push(`${p.figma}=${figmaValue}`); continue; }
    args[p.codeArg] = v.code;
  }
  return { args, interaction, unmapped };
}

/** Pick the story to render variants in: prefer Usage/Default/Playground, else the one exposing most mapped args. */
export function pickStory(codeComp, propMatch, cfg) {
  const preferred = (cfg.storybook?.preferredStories ?? ['Usage', 'Default', 'Playground', 'Basic', 'Primary']).map(norm);
  const wanted = propMatch.props.map((p) => p.codeArg).filter(Boolean);
  const stories = codeComp.stories;
  const byPref = preferred.map((n) => stories.find((s) => norm(s.name) === n)).find(Boolean);
  if (byPref) return byPref;
  return [...stories].sort((a, b) => wanted.filter((w) => w in (b.argTypes ?? {})).length - wanted.filter((w) => w in (a.argTypes ?? {})).length)[0];
}
