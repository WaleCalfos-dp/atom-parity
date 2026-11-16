// Atom Parity Exporter — Figma plugin (main thread)
// Reads every component set in the file: variant properties, the variables
// bound to each layer, the value every bound variable resolves to in each brand
// mode, and (optionally) a PNG render of each variant per brand. Produces
// figma-manifest.json for the atom-parity CLI.
//
// Works on every Figma plan: variables are read through the Plugin API, not the
// Enterprise-only Variables REST API.

var PLUGIN_VERSION = '1.0.0';
var MANIFEST_SCHEMA = 'atom-parity/figma@1';
var MAX_LAYERS_PER_VARIANT = 80;

figma.showUI(__html__, { width: 460, height: 680, themeColors: true });

// ---------------------------------------------------------------- caches
var varCache = {};
var colCache = {};
var styleCache = {};

function getVar(id) {
  if (Object.prototype.hasOwnProperty.call(varCache, id)) return Promise.resolve(varCache[id]);
  return figma.variables.getVariableByIdAsync(id).then(function (v) {
    varCache[id] = v || null;
    return varCache[id];
  }).catch(function () { varCache[id] = null; return null; });
}

function getCol(id) {
  if (Object.prototype.hasOwnProperty.call(colCache, id)) return Promise.resolve(colCache[id]);
  return figma.variables.getVariableCollectionByIdAsync(id).then(function (c) {
    colCache[id] = c || null;
    return colCache[id];
  }).catch(function () { colCache[id] = null; return null; });
}

function getStyleName(id) {
  if (!id || typeof id !== 'string') return Promise.resolve(null);
  if (Object.prototype.hasOwnProperty.call(styleCache, id)) return Promise.resolve(styleCache[id]);
  return figma.getStyleByIdAsync(id).then(function (s) {
    styleCache[id] = s ? s.name : null;
    return styleCache[id];
  }).catch(function () { styleCache[id] = null; return null; });
}

// ---------------------------------------------------------------- helpers
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

function progress(label, done, total) {
  figma.ui.postMessage({ type: 'progress', label: label, done: done, total: total });
}

function to255(x) { return Math.round(Math.max(0, Math.min(1, x)) * 255); }
function hex2(n) { var s = n.toString(16); return s.length === 1 ? '0' + s : s; }
function colorToHex(c, extraOpacity) {
  if (!c) return null;
  var a = (c.a === undefined ? 1 : c.a) * (extraOpacity === undefined ? 1 : extraOpacity);
  var h = '#' + hex2(to255(c.r)) + hex2(to255(c.g)) + hex2(to255(c.b));
  if (a < 0.999) h += hex2(to255(a));
  return h;
}

function isMixed(v) { return v === figma.mixed; }

function cleanPropName(name) {
  // Non-variant component properties carry an id suffix: "Show icon#123:4"
  var i = name.indexOf('#');
  return i === -1 ? name : name.slice(0, i);
}

var WEIGHTS = [
  [/thin|hairline/i, 100], [/extra\s*light|ultra\s*light/i, 200], [/light/i, 300],
  [/semi\s*bold|demi\s*bold/i, 600], [/extra\s*bold|ultra\s*bold/i, 800], [/black|heavy/i, 900],
  [/bold/i, 700], [/medium/i, 500], [/regular|normal|book|roman/i, 400]
];
function styleToWeight(style) {
  if (!style) return null;
  for (var i = 0; i < WEIGHTS.length; i++) if (WEIGHTS[i][0].test(style)) return WEIGHTS[i][1];
  var n = parseInt(style, 10);
  return isNaN(n) ? 400 : n;
}

function serializeValue(raw, type) {
  if (raw === undefined || raw === null) return null;
  if (type === 'COLOR' && typeof raw === 'object' && 'r' in raw) return colorToHex(raw);
  return raw;
}

function pageOf(node) {
  var n = node;
  while (n && n.type !== 'PAGE') n = n.parent;
  return n;
}

function framePath(node) {
  var parts = [];
  var n = node.parent;
  while (n && n.type !== 'PAGE' && n.type !== 'DOCUMENT') { parts.unshift(n.name); n = n.parent; }
  return parts.join(' / ');
}

// ---------------------------------------------------------------- discovery
function shouldSkip(node, opts) {
  var name = node.name || '';
  for (var i = 0; i < opts.privatePrefixes.length; i++) {
    if (opts.privatePrefixes[i] && name.indexOf(opts.privatePrefixes[i]) === 0) return true;
  }
  var page = pageOf(node);
  if (page && opts.includePages.length && opts.scope !== 'selection') {
    var ok = opts.includePages.some(function (p) { return page.name.indexOf(p) !== -1; });
    if (!ok) return true;
  }
  if (page && opts.skipPages.length) {
    var pn = page.name.toLowerCase();
    for (var j = 0; j < opts.skipPages.length; j++) if (opts.skipPages[j] && pn.indexOf(opts.skipPages[j]) !== -1) return true;
  }
  return false;
}

// Atom groups component pages under divider pages ("━ CORE COMPONENTS ━", "ACTIONS",
// "SYSTEM FEEDBACK" …). Map every page to the nearest divider above it.
function isSectionPage(name) {
  var n = name.trim();
  if (!n || /[❖↳]/.test(n)) return false;
  if (n.indexOf('━') !== -1) return true;
  return /^[A-Z][A-Z &/-]{2,}$/.test(n);
}
function cleanPageName(name) {
  return name.replace(/[━❖↳*]/g, '').replace(/\s+/g, ' ').trim();
}
function sectionMap() {
  var map = {}; var current = null; var group = null;
  figma.root.children.forEach(function (p) {
    if (isSectionPage(p.name)) {
      if (p.name.indexOf('━') !== -1) { group = cleanPageName(p.name); current = null; }
      else current = cleanPageName(p.name);
      return;
    }
    map[p.id] = { group: group, section: current };
  });
  return map;
}

async function findComponents(opts) {
  var roots = [];
  if (opts.scope === 'selection') roots = figma.currentPage.selection.slice();
  else if (opts.scope === 'page') roots = [figma.currentPage];
  else { await figma.loadAllPagesAsync(); roots = figma.root.children.slice(); }

  var seen = {};
  var out = [];
  function add(n) {
    if (seen[n.id]) return;
    if (n.type === 'COMPONENT' && n.parent && n.parent.type === 'COMPONENT_SET') return; // variants handled via set
    if (shouldSkip(n, opts)) return;
    seen[n.id] = true;
    out.push(n);
  }
  for (var i = 0; i < roots.length; i++) {
    var r = roots[i];
    if (r.type === 'COMPONENT_SET' || r.type === 'COMPONENT') add(r);
    if (r.type === 'COMPONENT' && r.parent && r.parent.type === 'COMPONENT_SET') add(r.parent);
    if ('findAllWithCriteria' in r) {
      var found = r.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] });
      for (var k = 0; k < found.length; k++) add(found[k]);
    }
  }
  out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return out;
}

function variantsOf(node) {
  if (node.type === 'COMPONENT_SET') return node.children.filter(function (c) { return c.type === 'COMPONENT'; });
  return [node];
}

function propertyDefs(node) {
  var defs = {};
  var raw = {};
  try { raw = node.componentPropertyDefinitions || {}; } catch (e) { raw = {}; }
  Object.keys(raw).forEach(function (k) {
    var d = raw[k];
    defs[cleanPropName(k)] = {
      type: d.type,
      defaultValue: d.defaultValue,
      options: d.variantOptions || null
    };
  });
  return defs;
}

// Pick which variants get rendered when a set is larger than the cap:
// default variant first, then make sure every value of every property is
// covered at least once (closest to the default), then fill in order.
function sampleVariants(variants, cap) {
  if (variants.length <= cap) return variants.slice();
  var def = variants[0];
  var defProps = def.variantProperties || {};
  var picked = [def];
  var pickedIds = {}; pickedIds[def.id] = true;
  function distance(v) {
    var p = v.variantProperties || {}; var d = 0;
    Object.keys(p).forEach(function (k) { if (p[k] !== defProps[k]) d++; });
    return d;
  }
  var sorted = variants.slice().sort(function (a, b) { return distance(a) - distance(b); });
  var keys = Object.keys(defProps);
  for (var i = 0; i < keys.length && picked.length < cap; i++) {
    var key = keys[i];
    var values = {};
    variants.forEach(function (v) { values[(v.variantProperties || {})[key]] = true; });
    Object.keys(values).forEach(function (val) {
      if (picked.length >= cap) return;
      var covered = picked.some(function (p) { return (p.variantProperties || {})[key] === val; });
      if (covered) return;
      for (var j = 0; j < sorted.length; j++) {
        if ((sorted[j].variantProperties || {})[key] === val && !pickedIds[sorted[j].id]) {
          picked.push(sorted[j]); pickedIds[sorted[j].id] = true; break;
        }
      }
    });
  }
  for (var m = 0; m < sorted.length && picked.length < cap; m++) {
    if (!pickedIds[sorted[m].id]) { picked.push(sorted[m]); pickedIds[sorted[m].id] = true; }
  }
  return picked;
}

// ---------------------------------------------------------------- layer extraction
function collectAliasIds(value, into) {
  if (!value) return;
  if (Array.isArray(value)) { value.forEach(function (v) { collectAliasIds(v, into); }); return; }
  if (typeof value === 'object' && value.type === 'VARIABLE_ALIAS' && value.id) into.push(value.id);
}

function firstSolid(paints) {
  if (!Array.isArray(paints)) return null;
  for (var i = 0; i < paints.length; i++) {
    var p = paints[i];
    if (p.visible === false) continue;
    if (p.type === 'SOLID') return p;
  }
  return null;
}

function hasNonSolidPaint(paints) {
  if (!Array.isArray(paints)) return false;
  return paints.some(function (p) { return p.visible !== false && p.type !== 'SOLID'; });
}

async function describeLayer(node, path, depth, usedVarIds) {
  var layer = { path: path, name: node.name, type: node.type, depth: depth, bindings: {}, raw: {}, styles: {} };

  // Variable bindings on the node itself
  var bv = {};
  try { bv = node.boundVariables || {}; } catch (e) { bv = {}; }
  Object.keys(bv).forEach(function (prop) {
    var ids = [];
    collectAliasIds(bv[prop], ids);
    if (ids.length) { layer.bindings[prop] = ids; ids.forEach(function (id) { usedVarIds[id] = true; }); }
  });

  // Paint-level bindings (colour variables live on the paint)
  ['fills', 'strokes'].forEach(function (key) {
    var paints;
    try { paints = node[key]; } catch (e) { paints = null; }
    if (!Array.isArray(paints)) return;
    var solid = firstSolid(paints);
    if (solid) {
      layer.raw[key] = colorToHex(solid.color, solid.opacity);
      if (solid.boundVariables && solid.boundVariables.color && solid.boundVariables.color.id) {
        var id = solid.boundVariables.color.id;
        if (!layer.bindings[key]) layer.bindings[key] = [];
        if (layer.bindings[key].indexOf(id) === -1) layer.bindings[key].push(id);
        usedVarIds[id] = true;
      }
    }
    if (hasNonSolidPaint(paints)) layer.raw[key + 'NonSolid'] = true;
  });

  var fillStyle = null, strokeStyle = null, textStyle = null, effectStyle = null;
  try { fillStyle = await getStyleName(node.fillStyleId); } catch (e) { /* mixed */ }
  try { strokeStyle = await getStyleName(node.strokeStyleId); } catch (e) { /* none */ }
  try { effectStyle = await getStyleName(node.effectStyleId); } catch (e) { /* none */ }
  if (fillStyle) layer.styles.fill = fillStyle;
  if (strokeStyle) layer.styles.stroke = strokeStyle;
  if (effectStyle) layer.styles.effect = effectStyle;

  var numeric = ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'opacity', 'strokeWeight', 'strokeTopWeight',
    'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
    'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'counterAxisSpacing'];
  numeric.forEach(function (k) {
    var v;
    try { v = node[k]; } catch (e) { return; }
    if (typeof v === 'number' && !isNaN(v)) layer.raw[k] = Math.round(v * 100) / 100;
  });
  ['layoutMode', 'layoutSizingHorizontal', 'layoutSizingVertical', 'primaryAxisAlignItems', 'counterAxisAlignItems'].forEach(function (k) {
    var v;
    try { v = node[k]; } catch (e) { return; }
    if (typeof v === 'string') layer.raw[k] = v;
  });
  try {
    if (Array.isArray(node.effects) && node.effects.some(function (e) { return e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'); })) layer.raw.shadow = true;
  } catch (e) { /* none */ }

  if (node.type === 'TEXT') {
    var t = layer.raw;
    try {
      var fs = node.fontSize; t.fontSize = isMixed(fs) ? node.getRangeFontSize(0, 1) : fs;
      var fn = node.fontName; if (isMixed(fn)) fn = node.getRangeFontName(0, 1);
      t.fontFamily = fn.family; t.fontStyle = fn.style; t.fontWeight = styleToWeight(fn.style);
      var lh = node.lineHeight; if (isMixed(lh)) lh = node.getRangeLineHeight(0, 1);
      t.lineHeight = lh && lh.unit === 'AUTO' ? 'AUTO' : (lh && lh.unit === 'PIXELS' ? lh.value : (lh ? lh.value + '%' : null));
      var ls = node.letterSpacing; if (isMixed(ls)) ls = node.getRangeLetterSpacing(0, 1);
      t.letterSpacing = ls ? (ls.unit === 'PIXELS' ? ls.value : ls.value + '%') : null;
      var tc = node.textCase; if (!isMixed(tc)) t.textCase = tc;
      t.characters = (node.characters || '').slice(0, 60);
      if (isMixed(node.fills)) {
        var segFills = node.getRangeFills(0, 1);
        var s = firstSolid(segFills);
        if (s) {
          t.fills = colorToHex(s.color, s.opacity);
          if (s.boundVariables && s.boundVariables.color) {
            layer.bindings.fills = [s.boundVariables.color.id];
            usedVarIds[s.boundVariables.color.id] = true;
          }
        }
      }
      textStyle = await getStyleName(isMixed(node.textStyleId) ? node.getRangeTextStyleId(0, 1) : node.textStyleId);
      if (textStyle) layer.styles.text = textStyle;
    } catch (e) { layer.raw.textError = String(e); }
  }

  if (node.type === 'INSTANCE') {
    try {
      var main = await node.getMainComponentAsync();
      if (main) {
        layer.instanceOf = main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent.name : main.name;
        layer.instanceVariant = main.variantProperties || null;
      }
    } catch (e) { /* remote/missing */ }
  }
  return layer;
}

async function walkLayers(node, path, depth, out, usedVarIds) {
  if (out.length >= MAX_LAYERS_PER_VARIANT) return;
  if (node.visible === false && depth > 0) return;
  out.push(await describeLayer(node, path, depth, usedVarIds));
  if (node.type === 'INSTANCE' && depth > 0) return; // record composition, don't descend into other components
  if ('children' in node) {
    for (var i = 0; i < node.children.length; i++) {
      var c = node.children[i];
      await walkLayers(c, path + ' / ' + c.name, depth + 1, out, usedVarIds);
    }
  }
}

// ---------------------------------------------------------------- variables
async function resolveVariable(id, modeName, depth) {
  depth = depth || 0;
  var v = await getVar(id);
  if (!v) return { value: null, chain: [] };
  var col = await getCol(v.variableCollectionId);
  var modeId = null;
  if (col) {
    var m = col.modes.filter(function (x) { return x.name === modeName; })[0];
    modeId = m ? m.modeId : col.defaultModeId;
  }
  var raw = modeId ? v.valuesByMode[modeId] : undefined;
  if (raw === undefined) { var keys = Object.keys(v.valuesByMode); raw = keys.length ? v.valuesByMode[keys[0]] : null; }
  if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS' && depth < 12) {
    var r = await resolveVariable(raw.id, modeName, depth + 1);
    return { value: r.value, chain: [v.name].concat(r.chain) };
  }
  return { value: serializeValue(raw, v.resolvedType), chain: [v.name] };
}

async function buildVariableDictionary(ids, brandNames) {
  var dict = {};
  for (var i = 0; i < ids.length; i++) {
    var v = await getVar(ids[i]);
    if (!v) { dict[ids[i]] = { name: null, missing: true }; continue; }
    var col = await getCol(v.variableCollectionId);
    var entry = {
      name: v.name,
      collection: col ? col.name : null,
      collectionId: v.variableCollectionId,
      remote: !!v.remote,
      resolvedType: v.resolvedType,
      codeSyntax: v.codeSyntax || {},
      description: v.description || '',
      scopes: v.scopes || [],
      valuesByBrand: {},
      aliasByBrand: {}
    };
    for (var b = 0; b < brandNames.length; b++) {
      var r = await resolveVariable(ids[i], brandNames[b]);
      entry.valuesByBrand[brandNames[b]] = r.value;
      if (r.chain.length > 1) entry.aliasByBrand[brandNames[b]] = r.chain.slice(1).join(' → ');
    }
    dict[ids[i]] = entry;
    if (i % 25 === 0) { progress('Resolving tokens', i, ids.length); await tick(); }
  }
  return dict;
}

// ---------------------------------------------------------------- scan
async function scan(opts) {
  progress('Finding components', 0, 1);
  var comps = await findComponents(opts);
  var variantCount = 0;
  var colUsage = {};
  for (var i = 0; i < comps.length; i++) {
    var vs = variantsOf(comps[i]);
    variantCount += vs.length;
    // Light pass: root + first two levels of the first variant is enough to find collections in use
    var ids = {};
    var tmp = [];
    await walkLayersShallow(vs[0], 2, ids, tmp);
    var idList = Object.keys(ids);
    for (var k = 0; k < idList.length; k++) {
      var v = await getVar(idList[k]);
      if (v) colUsage[v.variableCollectionId] = (colUsage[v.variableCollectionId] || 0) + 1;
    }
    if (i % 10 === 0) { progress('Scanning', i, comps.length); await tick(); }
  }
  // Also include local collections (brand switcher may be local)
  try {
    var locals = await figma.variables.getLocalVariableCollectionsAsync();
    locals.forEach(function (c) { if (!(c.id in colUsage)) colUsage[c.id] = 0; colCache[c.id] = c; });
  } catch (e) { /* none */ }

  var collections = [];
  var colIds = Object.keys(colUsage);
  for (var j = 0; j < colIds.length; j++) {
    var col = await getCol(colIds[j]);
    if (!col) continue;
    collections.push({
      id: col.id, name: col.name, remote: !!col.remote, usage: colUsage[col.id],
      defaultModeId: col.defaultModeId,
      modes: col.modes.map(function (m) { return { id: m.modeId, name: m.name }; })
    });
  }
  // Brand collection guess: most modes, then most used, then name hint
  collections.sort(function (a, b) {
    var hint = function (c) { return /brand|switch|theme/i.test(c.name) ? 1 : 0; };
    return (hint(b) - hint(a)) || (b.modes.length - a.modes.length) || (b.usage - a.usage);
  });
  return {
    file: figma.root.name,
    components: comps.length,
    variants: variantCount,
    collections: collections,
    suggestedBrandCollection: collections.length ? collections[0].id : null
  };
}

async function walkLayersShallow(node, maxDepth, ids, out, depth) {
  depth = depth || 0;
  if (depth > maxDepth) return;
  await describeLayer(node, node.name, depth, ids);
  if (node.type === 'INSTANCE' && depth > 0) return;
  if ('children' in node) for (var i = 0; i < node.children.length; i++) await walkLayersShallow(node.children[i], maxDepth, ids, out, depth + 1);
}

// ---------------------------------------------------------------- export
async function exportManifest(opts) {
  var started = Date.now();
  var comps = await findComponents(opts);
  var sections = sectionMap();
  var brandCol = opts.brandCollectionId ? await getCol(opts.brandCollectionId) : null;
  var brandModes = brandCol ? brandCol.modes.filter(function (m) {
    return !opts.brands || !opts.brands.length || opts.brands.indexOf(m.name) !== -1;
  }) : [];
  var brandNames = brandModes.map(function (m) { return m.name; });
  if (!brandNames.length) brandNames = ['Default'];

  var usedVarIds = {};
  var components = [];
  var totalRenders = 0;
  var tempFrame = null;

  try {
    if (opts.renders) {
      tempFrame = figma.createFrame();
      tempFrame.name = '[atom-parity] temporary render frame — safe to delete';
      tempFrame.fills = [];
      tempFrame.clipsContent = false;
      tempFrame.layoutMode = 'HORIZONTAL';
      tempFrame.primaryAxisSizingMode = 'AUTO';
      tempFrame.counterAxisSizingMode = 'AUTO';
      tempFrame.x = -200000; tempFrame.y = -200000;
      tempFrame.locked = true;
    }

    for (var i = 0; i < comps.length; i++) {
      var node = comps[i];
      var page = pageOf(node);
      var all = variantsOf(node);
      var toRender = opts.renders ? sampleVariants(all, opts.maxVariants) : [];
      var renderIds = {}; toRender.forEach(function (v) { renderIds[v.id] = true; });

      var comp = {
        id: node.id,
        key: node.key || null,
        name: node.name,
        type: node.type,
        page: page ? cleanPageName(page.name) : null,
        group: page && sections[page.id] ? sections[page.id].group : null,
        section: page && sections[page.id] ? sections[page.id].section : null,
        frame: framePath(node),
        description: node.description || '',
        docLinks: (node.documentationLinks || []).map(function (l) { return l.uri; }),
        properties: propertyDefs(node),
        variants: []
      };

      for (var j = 0; j < all.length; j++) {
        var v = all[j];
        var layers = [];
        await walkLayers(v, v.name, 0, layers, usedVarIds);
        var variant = {
          id: v.id,
          name: v.name,
          props: v.variantProperties || {},
          isDefault: j === 0,
          width: Math.round(v.width * 100) / 100,
          height: Math.round(v.height * 100) / 100,
          sizing: { h: layers[0].raw.layoutSizingHorizontal || 'FIXED', v: layers[0].raw.layoutSizingVertical || 'FIXED', layoutMode: layers[0].raw.layoutMode || 'NONE' },
          layers: layers,
          renders: {}
        };

        if (renderIds[v.id] && tempFrame) {
          var inst = v.createInstance();
          tempFrame.appendChild(inst);
          for (var b = 0; b < brandModes.length || (b === 0 && !brandModes.length); b++) {
            var bName = brandModes.length ? brandModes[b].name : 'Default';
            if (brandModes.length) {
              try { tempFrame.setExplicitVariableModeForCollection(brandCol, brandModes[b].modeId); }
              catch (e) { tempFrame.setExplicitVariableModeForCollection(brandCol.id, brandModes[b].modeId); }
            }
            try {
              var bytes = await inst.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: opts.scale } });
              variant.renders[bName] = 'data:image/png;base64,' + figma.base64Encode(bytes);
              totalRenders++;
            } catch (e) {
              variant.renders[bName] = null;
              variant.renderError = String(e);
            }
            if (!brandModes.length) break;
          }
          inst.remove();
        }
        comp.variants.push(variant);
      }
      components.push(comp);
      progress('Exporting ' + node.name, i + 1, comps.length);
      await tick();
    }
  } finally {
    if (tempFrame && !tempFrame.removed) { tempFrame.locked = false; tempFrame.remove(); }
  }

  var ids = Object.keys(usedVarIds);
  var variables = await buildVariableDictionary(ids, brandNames);

  var fileKey = null;
  try { fileKey = figma.fileKey || null; } catch (e) { fileKey = null; }
  var exportedBy = null;
  try { exportedBy = figma.currentUser ? figma.currentUser.name : null; } catch (e) { exportedBy = null; }

  return {
    schema: MANIFEST_SCHEMA,
    pluginVersion: PLUGIN_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: exportedBy,
    file: { name: figma.root.name, key: fileKey },
    scope: opts.scope,
    brandCollection: brandCol ? {
      id: brandCol.id, name: brandCol.name,
      modes: brandModes.map(function (m) { return { id: m.modeId, name: m.name }; }),
      defaultMode: (brandCol.modes.filter(function (m) { return m.modeId === brandCol.defaultModeId; })[0] || {}).name || null
    } : null,
    brands: brandNames,
    renderScale: opts.renders ? opts.scale : null,
    stats: {
      components: components.length,
      variants: components.reduce(function (n, c) { return n + c.variants.length; }, 0),
      renders: totalRenders,
      variables: ids.length,
      durationMs: Date.now() - started
    },
    components: components,
    variables: variables
  };
}

// ---------------------------------------------------------------- messaging
function normaliseOpts(o) {
  o = o || {};
  return {
    scope: o.scope || 'file',
    privatePrefixes: (o.privatePrefixes || '.,_').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    includePages: (o.includePages === undefined ? '❖' : o.includePages).split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    skipPages: (o.skipPages || 'archive,deprecated,playground').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean),
    brandCollectionId: o.brandCollectionId || null,
    brands: o.brands || [],
    renders: o.renders !== false,
    scale: Number(o.scale) || 2,
    maxVariants: Number(o.maxVariants) || 40
  };
}

figma.ui.onmessage = async function (msg) {
  try {
    if (msg.type === 'init') {
      var saved = await figma.clientStorage.getAsync('atom-parity-settings');
      figma.ui.postMessage({ type: 'init', settings: saved || {}, file: figma.root.name, selection: figma.currentPage.selection.length });
    } else if (msg.type === 'save-settings') {
      await figma.clientStorage.setAsync('atom-parity-settings', msg.settings);
    } else if (msg.type === 'scan') {
      var result = await scan(normaliseOpts(msg.options));
      figma.ui.postMessage({ type: 'scan-result', result: result });
    } else if (msg.type === 'export') {
      var manifest = await exportManifest(normaliseOpts(msg.options));
      figma.ui.postMessage({ type: 'export-result', manifest: manifest });
      figma.notify('Atom parity snapshot ready: ' + manifest.stats.components + ' components, ' + manifest.stats.renders + ' renders');
    } else if (msg.type === 'notify') {
      figma.notify(msg.text, { error: !!msg.error });
    } else if (msg.type === 'close') {
      figma.closePlugin();
    }
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: String(e && e.message ? e.message : e) });
  }
};
