// Builds the same manifest the plugin exports, straight from a Figma link via the REST API.
// Works on the Pro plan: file structure, variant properties, layout, resolved colours and renders.
// Variable names and per-brand values are Enterprise-only in REST, so they come from the most
// recent plugin snapshot when one exists (variable ids are the same in both).
import fs from 'node:fs';
import { log, norm, readJson } from './util.js';

const API = 'https://api.figma.com';

export function parseFigmaUrl(url) {
  const u = new URL(url);
  const m = u.pathname.match(/\/(?:design|file|proto)\/([0-9A-Za-z]{10,})(?:\/branch\/([0-9A-Za-z]{10,}))?/);
  if (!m) throw new Error(`That doesn't look like a Figma file link: ${url}`);
  const nodeParam = u.searchParams.get('node-id');
  return { fileKey: m[2] || m[1], nodeId: nodeParam ? nodeParam.replace('-', ':') : null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function figmaGet(path, token, attempt = 0) {
  const res = await fetch(`${API}${path}`, { headers: { 'X-Figma-Token': token } });
  if (res.status === 429 && attempt < 5) {
    const wait = Math.min(Number(res.headers.get('retry-after') ?? 30), 120);
    log.info(`Figma rate limit, waiting ${wait}s`);
    await sleep(wait * 1000);
    return figmaGet(path, token, attempt + 1);
  }
  if (res.status === 403) throw new Error('Figma refused the request. Check that FIGMA_TOKEN is set, hasn\'t expired, and belongs to someone who can open this file.');
  if (res.status === 404) throw new Error('Figma couldn\'t find that file or node. Check the Figma link.');
  if (!res.ok) throw new Error(`Figma API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ---------------------------------------------------------------- helpers shared with the plugin's logic
export const isSectionPage = (name) => {
  const n = name.trim();
  if (!n || /[❖↳]/.test(n)) return false;
  if (n.includes('━')) return true;
  return /^[A-Z][A-Z &/-]{2,}$/.test(n);
};
/**
 * Pages under a section or group divider. Every page counts, not only ❖ pages, so groups such as
 * PRODUCT MODULES (emoji pages) and PATTERNS (↳ pages) are covered. Skipped: deprecated or archive pages,
 * and placeholder pages with no letters in their name ("---").
 */
export function pagesInScope(pages, sections, divider, skip = []) {
  const isGroup = divider.name.includes('━'); const label = cleanPageName(divider.name);
  return pages.filter((p) => {
    const s = sections[p.id];
    if (!s || !(isGroup ? s.group === label : s.section === label)) return false;
    if (skip.some((k) => p.name.toLowerCase().includes(k))) return false;
    return /\p{L}/u.test(p.name);
  }).map((p) => p.id);
}
export const cleanPageName = (name) => name.replace(/[━❖↳*]/g, '').replace(/\s+/g, ' ').trim();
export function sectionMap(pages) {
  const map = {}; let current = null; let group = null;
  for (const p of pages) {
    if (isSectionPage(p.name)) { if (p.name.includes('━')) { group = cleanPageName(p.name); current = null; } else current = cleanPageName(p.name); continue; }
    map[p.id] = { group, section: current };
  }
  return map;
}

const to255 = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255);
const hex2 = (n) => n.toString(16).padStart(2, '0');
function colorToHex(c, extra = 1) {
  if (!c) return null;
  const a = (c.a ?? 1) * extra;
  return `#${hex2(to255(c.r))}${hex2(to255(c.g))}${hex2(to255(c.b))}${a < 0.999 ? hex2(to255(a)) : ''}`;
}
const firstSolid = (paints) => (Array.isArray(paints) ? paints.find((p) => p.visible !== false && p.type === 'SOLID') : null);

function aliasIds(v, into) {
  if (!v) return;
  if (Array.isArray(v)) { v.forEach((x) => aliasIds(x, into)); return; }
  if (typeof v === 'object' && v.id && (v.type === 'VARIABLE_ALIAS' || String(v.id).startsWith('VariableID'))) into.push(v.id);
}

const parseVariantName = (name) => Object.fromEntries(String(name).split(',').map((p) => p.split('=').map((s) => s.trim())).filter((kv) => kv.length === 2));

function describe(node, path, depth, ctx) {
  const layer = { path, name: node.name, type: node.type, depth, bindings: {}, raw: {}, styles: {} };
  for (const [prop, val] of Object.entries(node.boundVariables ?? {})) {
    const ids = []; aliasIds(val, ids);
    if (ids.length) layer.bindings[prop] = ids;
  }
  for (const key of ['fills', 'strokes']) {
    const solid = firstSolid(node[key]);
    if (solid) {
      layer.raw[key] = colorToHex(solid.color, solid.opacity ?? 1);
      const id = solid.boundVariables?.color?.id;
      if (id) { layer.bindings[key] = layer.bindings[key] ?? []; if (!layer.bindings[key].includes(id)) layer.bindings[key].push(id); }
    }
  }
  const bb = node.absoluteBoundingBox ?? node.size ?? {};
  if (typeof bb.width === 'number') layer.raw.width = Math.round(bb.width * 100) / 100;
  if (typeof bb.height === 'number') layer.raw.height = Math.round(bb.height * 100) / 100;
  for (const k of ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'counterAxisSpacing', 'strokeWeight', 'cornerRadius', 'minWidth', 'minHeight', 'maxWidth']) {
    if (typeof node[k] === 'number') layer.raw[k] = Math.round(node[k] * 100) / 100;
  }
  if (node.layoutMode || node.type === 'COMPONENT' || node.type === 'FRAME' || node.type === 'INSTANCE') {
    for (const k of ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing']) if (layer.raw[k] === undefined && node.layoutMode) layer.raw[k] = 0;
  }
  layer.raw.opacity = typeof node.opacity === 'number' ? node.opacity : 1;
  if (Array.isArray(node.rectangleCornerRadii)) [layer.raw.topLeftRadius, layer.raw.topRightRadius, layer.raw.bottomRightRadius, layer.raw.bottomLeftRadius] = node.rectangleCornerRadii;
  else if (typeof node.cornerRadius === 'number') layer.raw.topLeftRadius = node.cornerRadius;
  if (node.individualStrokeWeights) layer.raw.strokeTopWeight = node.individualStrokeWeights.top;
  if (layer.raw.strokeWeight === undefined && node.strokes?.length) layer.raw.strokeWeight = 1;
  if (!node.strokes?.length) layer.raw.strokeWeight = 0;
  for (const k of ['layoutMode', 'layoutSizingHorizontal', 'layoutSizingVertical', 'primaryAxisAlignItems', 'counterAxisAlignItems']) if (typeof node[k] === 'string') layer.raw[k] = node[k];
  if (node.layoutMode && !layer.raw.primaryAxisAlignItems) layer.raw.primaryAxisAlignItems = 'MIN';
  if (node.effects?.some((e) => e.visible !== false && /SHADOW/.test(e.type))) layer.raw.shadow = true;
  for (const [k, id] of Object.entries(node.styles ?? {})) { const n = ctx.styles[id]?.name; if (n) layer.styles[k === 'fills' ? 'fill' : k] = n; }

  if (node.type === 'TEXT') {
    const s = node.style ?? {};
    layer.raw.fontSize = s.fontSize; layer.raw.fontFamily = s.fontFamily; layer.raw.fontWeight = s.fontWeight;
    layer.raw.fontStyle = s.fontStyle ?? null;
    layer.raw.lineHeight = s.lineHeightUnit === 'INTRINSIC_%' ? 'AUTO' : typeof s.lineHeightPx === 'number' ? Math.round(s.lineHeightPx * 100) / 100 : null;
    layer.raw.letterSpacing = s.letterSpacing ?? 0;
    layer.raw.textCase = s.textCase ?? 'ORIGINAL';
    layer.raw.characters = String(node.characters ?? '').slice(0, 60);
  }
  if (node.type === 'INSTANCE' && node.componentId) {
    const c = ctx.components[node.componentId];
    if (c) layer.instanceOf = c.componentSetId ? ctx.componentSets[c.componentSetId]?.name ?? c.name : c.name;
  }
  return layer;
}

function walk(node, path, depth, out, ctx) {
  if (out.length >= 80) return;
  if (node.visible === false && depth > 0) return;
  out.push(describe(node, path, depth, ctx));
  if (node.type === 'INSTANCE' && depth > 0) return;
  for (const c of node.children ?? []) walk(c, `${path} / ${c.name}`, depth + 1, out, ctx);
}

function findComponents(root, opts, found = []) {
  for (const c of root.children ?? []) {
    const name = c.name ?? '';
    const priv = opts.privatePrefixes.some((p) => p && name.startsWith(p));
    if (c.type === 'COMPONENT_SET') { if (!priv) found.push(c); continue; }
    if (c.type === 'COMPONENT') { if (!priv) found.push(c); continue; }
    if (c.children) findComponents(c, opts, found);
  }
  return found;
}

// ---------------------------------------------------------------- main
export async function manifestFromFigmaUrl(url, cfg, { token = process.env.FIGMA_TOKEN, snapshotPath, sample } = {}) {
  if (!token) throw new Error('FIGMA_TOKEN is not set. Add it as a GitHub secret (see the README).');
  const { fileKey, nodeId } = parseFigmaUrl(url);
  log.step('Reading Figma');
  const file = await figmaGet(`/v1/files/${fileKey}?depth=1`, token);
  const pages = file.document.children.map((p) => ({ id: p.id, name: p.name }));
  const sections = sectionMap(pages);
  const include = (cfg.figma?.includePages ?? ['❖']).filter(Boolean);
  const skip = (cfg.figma?.skipPages ?? ['archive', 'deprecated', 'playground']).map((s) => s.toLowerCase());
  const opts = { privatePrefixes: cfg.figma?.privatePrefixes ?? ['.', '_'] };

  const keep = (p) => include.some((i) => p.name.includes(i)) && !skip.some((s) => p.name.toLowerCase().includes(s));
  let scope = 'file'; let roots; let scopeLabel = null;
  const divider = nodeId ? pages.find((p) => p.id === nodeId && isSectionPage(p.name)) : null;
  if (divider) {
    // A link to a section divider page (ACTIONS, ━ CORE COMPONENTS ━) checks every component page in that section
    const isGroup = divider.name.includes('━'); scopeLabel = cleanPageName(divider.name);
    roots = pagesInScope(pages, sections, divider, skip);
    if (!roots.length) throw new Error(`No component pages found under "${scopeLabel}" in Figma. Link to a page whose name starts with ❖, or to the whole file.`);
    scope = 'section';
  } else if (nodeId && pages.some((p) => p.id === nodeId)) { scope = 'page'; roots = [nodeId]; }
  else if (nodeId) { scope = 'selection'; roots = [nodeId]; }
  else roots = pages.filter(keep).map((p) => p.id);
  log.info(`${file.name} · ${scope === 'file' ? `${roots.length} component pages` : scope === 'section' ? `${roots.length} component pages in ${scopeLabel}` : `one ${scope}`} · last edited ${file.lastModified}`);

  // Plugin snapshot: token names, brand modes, per-brand renders
  let snapshot = null;
  if (snapshotPath && fs.existsSync(snapshotPath)) {
    try { snapshot = readJson(snapshotPath); } catch { snapshot = null; }
    if (snapshot && snapshot.file?.key && snapshot.file.key !== fileKey) snapshot = null;
    if (snapshot) log.info(`Using token data from the plugin snapshot of ${snapshot.exportedAt}`);
  }
  const defaultBrand = snapshot?.brandCollection?.defaultMode ?? cfg.brands?.figmaDefault ?? cfg.brands?.figmaBrands?.[0] ?? 'Default';
  const snapVariants = new Map();
  for (const c of snapshot?.components ?? []) for (const v of c.variants) snapVariants.set(v.id, v);

  const components = [];
  for (let i = 0; i < roots.length; i++) {
    const id = roots[i];
    const res = await figmaGet(`/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(id)}`, token);
    const doc = res.nodes?.[id]?.document;
    if (!doc) {
      if (scope === 'page' || scope === 'selection') throw new Error(`Figma couldn't find node ${id} in "${file.name}". The page may have been deleted or the link copied from another file.`);
      continue;
    }
    const ctx = { styles: res.nodes[id].styles ?? {}, components: res.nodes[id].components ?? {}, componentSets: res.nodes[id].componentSets ?? {} };
    const pageMeta = pages.find((p) => p.id === id);
    const found = doc.type === 'COMPONENT_SET' || doc.type === 'COMPONENT' ? [doc] : findComponents(doc, opts);
    for (const node of found) {
      const isSet = node.type === 'COMPONENT_SET';
      const variantsRaw = isSet ? (node.children ?? []).filter((c) => c.type === 'COMPONENT') : [node];
      const meta = isSet ? ctx.componentSets[node.id] : ctx.components[node.id];
      const properties = {};
      for (const [k, d] of Object.entries(node.componentPropertyDefinitions ?? {})) {
        properties[k.split('#')[0]] = { type: d.type, defaultValue: d.defaultValue, options: d.variantOptions ?? null };
      }
      const variants = variantsRaw.map((v, j) => {
        const layers = []; walk(v, v.name, 0, layers, ctx);
        const snap = snapVariants.get(v.id);
        return {
          id: v.id, name: v.name, props: isSet ? parseVariantName(v.name) : {}, isDefault: j === 0,
          width: layers[0].raw.width, height: layers[0].raw.height,
          sizing: { h: v.layoutSizingHorizontal ?? 'FIXED', v: v.layoutSizingVertical ?? 'FIXED', layoutMode: v.layoutMode ?? 'NONE' },
          layers,
          renders: Object.fromEntries(Object.entries(snap?.renders ?? {}).filter(([b, d]) => b !== defaultBrand && d)),
        };
      });
      components.push({
        id: node.id, key: meta?.key ?? null, name: node.name, type: node.type,
        page: pageMeta ? cleanPageName(pageMeta.name) : null,
        group: sections[id]?.group ?? null, section: sections[id]?.section ?? null, pageOrder: pages.findIndex((p) => p.id === id),
        description: meta?.description ?? node.description ?? '', docLinks: (meta?.documentationLinks ?? []).map((l) => l.uri),
        properties, variants,
      });
    }
    if (roots.length > 1) { log.info(`page ${i + 1}/${roots.length}: ${pageMeta?.name?.trim() ?? id}`); await sleep(cfg.figma?.pageDelayMs ?? 4000); }
  }
  if (!components.length) throw new Error('No components found at that Figma link. Link to the component library file, or to a ❖ component page.');

  // Renders of the default brand, fresh from Figma
  const cap = cfg.visual?.maxVariantsPerComponent ?? 24;
  const wanted = components.flatMap((c) => sample(c.variants, cap)).map((v) => v.id);
  log.info(`Rendering ${wanted.length} variants in Figma`);
  const byId = new Map(components.flatMap((c) => c.variants.map((v) => [v.id, v])));
  for (let i = 0; i < wanted.length; i += 40) {
    const ids = wanted.slice(i, i + 40);
    const img = await figmaGet(`/v1/images/${fileKey}?ids=${encodeURIComponent(ids.join(','))}&scale=2&format=png`, token);
    await Promise.all(Object.entries(img.images ?? {}).map(async ([vid, u]) => {
      if (!u) return;
      try {
        const r = await fetch(u);
        if (r.ok) byId.get(vid).renders[defaultBrand] = `data:image/png;base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
      } catch { /* skip one image */ }
    }));
    if (i + 40 < wanted.length) await sleep(cfg.figma?.imageDelayMs ?? 6000);
  }

  const stale = snapshot && new Date(snapshot.exportedAt) < new Date(file.lastModified);
  return {
    schema: 'atom-parity/figma@1', pluginVersion: 'rest', source: 'figma-rest',
    exportedAt: new Date().toISOString(), exportedBy: null,
    file: { name: file.name, key: fileKey, lastModified: file.lastModified },
    scope, scopeLabel, figmaUrl: url,
    // Where this check sits in the library, so results can be grouped the way Figma groups them
    place: divider ? { group: divider.name.includes('━') ? scopeLabel : sections[roots[0]]?.group ?? null, section: divider.name.includes('━') ? null : scopeLabel, order: pages.indexOf(divider) }
      : scope === 'page' ? { group: sections[nodeId]?.group ?? null, section: sections[nodeId]?.section ?? null, order: pages.findIndex((p) => p.id === nodeId) } : null,
    brandCollection: snapshot?.brandCollection ?? { name: null, modes: [{ name: defaultBrand }], defaultMode: defaultBrand },
    brands: snapshot?.brands ?? (cfg.brands?.figmaBrands?.length ? cfg.brands.figmaBrands : [defaultBrand]),
    renderScale: 2,
    tokenSource: snapshot ? { exportedAt: snapshot.exportedAt, stale: !!stale } : null,
    stats: { components: components.length, variants: components.reduce((n, c) => n + c.variants.length, 0), renders: wanted.length, variables: Object.keys(snapshot?.variables ?? {}).length },
    components,
    variables: snapshot?.variables ?? {},
  };
}
