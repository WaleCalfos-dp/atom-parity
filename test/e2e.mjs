// End-to-end test: mock Atom Figma library → real plugin code → manifest → real Storybook build → report.
// Planted drift (each must be found):
//   Button  · Size "Regular" is "middle" in code (config-mapped) · Small is 42px tall vs 40px
//           · primary uses component token --aum-button-primary-bg-color instead of semantic token
//           · destructive label colour hard-coded · MasterCard hover colour differs
//   Tags    · plural name vs "Tag" · "Danger" missing (code still says "error") · success label hard-coded
//           · warning label fails contrast · Info colours not linked to variables in Figma
//   Accordion · called "Collapse" in code · no visible focus indicator
//   Switch  · 20px tall (target size) and smaller than design
//   Badge   · only in Figma        Alert · only in Storybook        Visa · brand with no Storybook equivalent
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { buildFigma, alias, solid, frame, text, component, componentSet, page, readCode } from './figma-mock.mjs';
import { loadConfig } from '../src/config.js';
import { run } from '../src/run.js';
import { writeReport } from '../src/report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- serve the Storybook build like the real host
const STATIC = path.join(here, 'sb', 'storybook-static');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (!p.startsWith('/atom-ui-mobile/')) { res.writeHead(404); return res.end(); }
  p = p.slice('/atom-ui-mobile/'.length) || 'index.html';
  let file = path.join(STATIC, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC, 'index.html'); // SPA fallback, like the real host
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const STORYBOOK_URL = `http://localhost:${PORT}/atom-ui-mobile/component?path=/`;

// ---------------------------------------------------------------- variables
const modes = [{ modeId: 'm1', name: 'Dragonpass' }, { modeId: 'm2', name: 'MasterCard' }, { modeId: 'm3', name: 'Visa' }];
const brandCol = { id: 'VariableCollectionId:1:1', name: 'Brand switcher', modes, defaultModeId: 'm1', remote: true };
const primCol = { id: 'VariableCollectionId:1:2', name: 'Primitives', modes: [{ modeId: 'p1', name: 'Value' }], defaultModeId: 'p1', remote: true };
const variables = []; const V = {};
let vid = 1;
const hexToRgb = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a: 1 });
function brandVar(name, type, dp, mc = dp, visa = dp) {
  const id = `VariableID:1:${vid++}`;
  const conv = (x) => (type === 'COLOR' ? hexToRgb(x) : x);
  variables.push({ id, name, variableCollectionId: brandCol.id, resolvedType: type, valuesByMode: { m1: conv(dp), m2: conv(mc), m3: conv(visa) }, codeSyntax: {}, scopes: [], description: '', remote: true });
  V[name] = id; return id;
}
function primVar(name, value) {
  const id = `VariableID:1:${vid++}`;
  variables.push({ id, name, variableCollectionId: primCol.id, resolvedType: 'FLOAT', valuesByMode: { p1: value }, codeSyntax: {}, scopes: [], remote: true });
  V[name] = id; return id;
}
brandVar('background/interactive/action', 'COLOR', '#0A2333', '#CF4500', '#1A1F71');
brandVar('background/interactive/action-hover', 'COLOR', '#0E5475', '#A33700', '#2A2F8F');
brandVar('background/interactive/action-disabled', 'COLOR', '#ECEAE9');
brandVar('foreground/interactive/action-disabled', 'COLOR', '#91908F');
brandVar('foreground/basic/inverse', 'COLOR', '#FFFFFF');
brandVar('background/interactive/control', 'COLOR', '#FFFFFF');
brandVar('border/basic/strong', 'COLOR', '#0A2333', '#141413', '#1A1F71');
brandVar('border/interactive/action-selected', 'COLOR', '#0A2333', '#CF4500', '#1A1F71');
brandVar('background/interactive/danger', 'COLOR', '#C2082A');
brandVar('components/button/secondary-color', 'COLOR', '#0A2333', '#141413', '#1A1F71');
brandVar('background/status/success-subtle', 'COLOR', '#E3F2EA');
brandVar('foreground/status/success', 'COLOR', '#1B7A4E');
brandVar('background/status/warning-subtle', 'COLOR', '#FFF4E0');
brandVar('foreground/status/warning', 'COLOR', '#8A5300');
brandVar('background/status/danger-subtle', 'COLOR', '#FBE5E8');
brandVar('foreground/status/danger', 'COLOR', '#C2082A');
brandVar('typography/body/family', 'STRING', 'DejaVu Sans');
const radiusId = `VariableID:1:${vid++}`;
variables.push({ id: radiusId, name: 'components/button/radius', variableCollectionId: brandCol.id, resolvedType: 'FLOAT', valuesByMode: { m1: alias('VariableID:9:1'), m2: alias('VariableID:9:1'), m3: alias('VariableID:9:1') }, codeSyntax: {}, scopes: [], remote: true });
variables.push({ id: 'VariableID:9:1', name: 'radius-full', variableCollectionId: primCol.id, resolvedType: 'FLOAT', valuesByMode: { p1: 999 }, codeSyntax: {}, scopes: [], remote: true });
V['components/button/radius'] = radiusId;
primVar('space-8', 8); primVar('space-16', 16); primVar('space-20', 20);

// ---------------------------------------------------------------- components
const bv = (map) => Object.fromEntries(Object.entries(map).map(([k, name]) => [k, alias(V[name])]));
const label = (chars, color, size = 16, weight = 'Medium', lh = 24) => text('Label', chars, {
  fontSize: size, fontName: { family: 'DejaVu Sans', style: weight }, lineHeight: { unit: 'PIXELS', value: lh },
  fills: [solid('#000000', V[color])], boundVariables: bv({ fontFamily: 'typography/body/family' }), width: 70, height: lh,
});

function buttonVariant(type, size, state) {
  const h = { Large: 56, Regular: 48, Small: 40 }[size];
  const padVar = size === 'Small' ? 'space-16' : 'space-20';
  let fill = { Primary: 'background/interactive/action', Secondary: 'background/interactive/control', Destructive: 'background/interactive/danger' }[type];
  let fg = { Primary: 'foreground/basic/inverse', Secondary: 'components/button/secondary-color', Destructive: 'foreground/basic/inverse' }[type];
  if (state === 'Hover' && type === 'Primary') fill = 'background/interactive/action-hover';
  if (state === 'Disabled') { fill = 'background/interactive/action-disabled'; fg = 'foreground/interactive/action-disabled'; }
  const strokes = type === 'Secondary' && state !== 'Disabled' ? [solid('#000000', V['border/basic/strong'])] : [];
  return component(`Type=${type}, Size=${size}, State=${state}`, { Type: type, Size: size, State: state }, {
    width: 120, height: h, layoutMode: 'HORIZONTAL', layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'FIXED', primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER',
    paddingLeft: size === 'Small' ? 16 : 20, paddingRight: size === 'Small' ? 16 : 20, paddingTop: 0, paddingBottom: 0, itemSpacing: 8,
    cornerRadius: 999, fills: [solid('#000000', V[fill])], strokes, strokeWeight: strokes.length ? 2 : 0,
    boundVariables: bv({ paddingLeft: padVar, paddingRight: padVar, itemSpacing: 'space-8', topLeftRadius: 'components/button/radius', topRightRadius: 'components/button/radius', bottomLeftRadius: 'components/button/radius', bottomRightRadius: 'components/button/radius' }),
  }, [label('Continue', fg, size === 'Small' ? 14 : 16)]);
}
const buttonVariants = [];
for (const t of ['Primary', 'Secondary', 'Destructive']) for (const s of ['Large', 'Regular', 'Small']) for (const st of ['Default', 'Hover', 'Focus', 'Disabled']) buttonVariants.push(buttonVariant(t, s, st));
// make Primary/Regular/Default the default variant (first child)
buttonVariants.sort((a, b) => (b.name === 'Type=Primary, Size=Regular, State=Default') - (a.name === 'Type=Primary, Size=Regular, State=Default'));
const button = componentSet('Button', { description: 'Primary call to action.' }, buttonVariants);

const tagTokens = { Success: ['background/status/success-subtle', 'foreground/status/success'], Warning: ['background/status/warning-subtle', 'foreground/status/warning'], Danger: ['background/status/danger-subtle', 'foreground/status/danger'] };
const tags = componentSet('Tags', { description: 'Status labels.' }, ['Success', 'Warning', 'Danger', 'Info'].map((t) => {
  const [bg, fg] = tagTokens[t] ?? [null, null];
  return component(`Type=${t}`, { Type: t }, {
    width: 60, height: 24, layoutMode: 'HORIZONTAL', layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'FIXED', primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER',
    paddingLeft: 8, paddingRight: 8, paddingTop: 0, paddingBottom: 0, itemSpacing: 4, cornerRadius: 4,
    fills: [bg ? solid('#000000', V[bg]) : solid('#E4EEF7')],
  }, [fg ? label('Label', fg, 12, 'Medium', 16) : text('Label', 'Label', { fontSize: 12, fontName: { family: 'DejaVu Sans', style: 'Medium' }, lineHeight: { unit: 'PIXELS', value: 16 }, fills: [solid('#2E5E8C')], width: 40, height: 16 })]);
}));

function accordionVariant(expanded, state) {
  const header = frame('Header', { layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'SPACE_BETWEEN', counterAxisAlignItems: 'CENTER', paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16, layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG', width: 343, height: 56 },
    [text('Title', 'Lounge access', { fontSize: 16, fontName: { family: 'DejaVu Sans', style: 'Medium' }, lineHeight: { unit: 'AUTO' }, fills: [solid('#000000')], width: 120, height: 19 }), text('Icon', expanded ? '−' : '+', { fontSize: 16, fontName: { family: 'DejaVu Sans', style: 'Medium' }, lineHeight: { unit: 'AUTO' }, fills: [solid('#000000')], width: 10, height: 19 })]);
  const kids = [header];
  if (expanded) kids.push(frame('Body', { layoutMode: 'VERTICAL', paddingLeft: 16, paddingRight: 16, paddingTop: 0, paddingBottom: 16, layoutSizingHorizontal: 'FILL', width: 343, height: 33 }, [text('Body', 'Two guests included with your membership.', { fontSize: 14, fontName: { family: 'DejaVu Sans', style: 'Regular' }, lineHeight: { unit: 'AUTO' }, fills: [solid('#3B4A55')], width: 300, height: 17 })]));
  kids.push(frame('Divider', { width: 343, height: 1, layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED', fills: [solid('#E3E0DE')] }));
  return component(`Expanded=${expanded ? 'True' : 'False'}, State=${state}`, { Expanded: expanded ? 'True' : 'False', State: state }, {
    width: 343, height: expanded ? 90 : 57, layoutMode: 'VERTICAL', layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG', paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, itemSpacing: 0,
    fills: state === 'Hover' ? [solid('#FAF8F7')] : [], strokes: state === 'Focus' ? [solid('#000000', V['border/interactive/action-selected'])] : [], strokeWeight: state === 'Focus' ? 2 : 0,
  }, kids);
}
const accordion = componentSet('Accordion', { description: '' }, ['False', 'True'].flatMap((e) => ['Default', 'Hover', 'Focus'].map((s) => accordionVariant(e === 'True', s))));

const switchSet = componentSet('Switch', { description: 'On/off control.' }, ['Off', 'On'].flatMap((c) => ['Default', 'Disabled'].map((s) => component(`Checked=${c}, State=${s}`, { Checked: c, State: s }, {
  width: 44, height: 24, layoutMode: 'HORIZONTAL', layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED', primaryAxisAlignItems: c === 'On' ? 'MAX' : 'MIN', counterAxisAlignItems: 'CENTER',
  paddingLeft: 2, paddingRight: 2, paddingTop: 2, paddingBottom: 2, itemSpacing: 0, cornerRadius: 12, opacity: s === 'Disabled' ? 0.4 : 1,
  fills: [c === 'On' ? solid('#000000', V['background/interactive/action']) : solid('#CECCCC')],
}, [frame('Knob', { width: 20, height: 20, cornerRadius: 10, fills: [solid('#FFFFFF')], layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED' })]))));

const badge = componentSet('Badge', {}, [component('Count=1', { Count: '1' }, { width: 20, height: 20, layoutMode: 'HORIZONTAL', cornerRadius: 10, fills: [solid('#C2082A')] }, [label('1', 'foreground/basic/inverse', 12, 'Medium', 16)])]);
const docsInstance = frame('_Component', { width: 400, height: 100 });

const pages = [
  page('Cover'), page('Playground', [componentSet('Scratch', {}, [component('Type=A', { Type: 'A' }, { width: 10, height: 10 }, [])])]),
  page('━ CORE COMPONENTS ━━━━━━━━━━━━'), page('ACTIONS'), page('      ❖ Button', [docsInstance, button]),
  page('DATA DISPLAY'), page('      ❖ Accordion', [accordion]), page('      ❖ Badge', [badge]), page('      ❖ Tags', [tags]),
  page('DATA ENTRY'), page('      ❖ Switch', [switchSet]),
  page('━ DEPRECATED ━━━━━━━━━━━━'), page('      ❖ Cards (deprecated)', [componentSet('Cards', {}, [component('Type=Old', { Type: 'Old' }, { width: 10, height: 10 }, [])])]),
];

// ---------------------------------------------------------------- design renderer (stands in for Figma's exporter)
const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'] }).catch(() => chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'] }));
const ctxs = {};
const varById = Object.fromEntries(variables.map((v) => [v.id, v]));
function resolve(id, modeName) {
  const v = varById[id]; const col = [brandCol, primCol].find((c) => c.id === v.variableCollectionId);
  const m = col.modes.find((x) => x.name === modeName) ?? col.modes.find((x) => x.modeId === col.defaultModeId);
  const raw = v.valuesByMode[m.modeId];
  return raw?.type === 'VARIABLE_ALIAS' ? resolve(raw.id, modeName) : raw;
}
const css = (c) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a ?? 1})`;
const paint = (p, mode) => (p.boundVariables?.color ? css(resolve(p.boundVariables.color.id, mode)) : css(p.color));
const W = { Regular: 400, Medium: 500, 'Semi Bold': 600, Bold: 700 };
function toHtml(n, mode) {
  if (n.type === 'TEXT') {
    const fam = n.boundVariables?.fontFamily ? resolve(n.boundVariables.fontFamily.id, mode) : n.fontName.family;
    return `<span style="font-family:'${fam}';font-size:${n.fontSize}px;font-weight:${W[n.fontName.style] ?? 400};line-height:${n.lineHeight.unit === 'PIXELS' ? n.lineHeight.value + 'px' : 'normal'};color:${n.fills[0] ? paint(n.fills[0], mode) : '#000'};white-space:nowrap">${n.characters}</span>`;
  }
  const st = ['box-sizing:border-box'];
  if (n.layoutMode && n.layoutMode !== 'NONE') {
    st.push('display:flex', `flex-direction:${n.layoutMode === 'HORIZONTAL' ? 'row' : 'column'}`, `gap:${n.itemSpacing ?? 0}px`,
      `padding:${n.paddingTop ?? 0}px ${n.paddingRight ?? 0}px ${n.paddingBottom ?? 0}px ${n.paddingLeft ?? 0}px`,
      `justify-content:${{ MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' }[n.primaryAxisAlignItems ?? 'MIN']}`,
      `align-items:${{ MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end' }[n.counterAxisAlignItems ?? 'MIN'] ?? 'stretch'}`);
  }
  if (n.layoutSizingVertical === 'FIXED' || n.type === 'FRAME' && !n.layoutMode) st.push(`height:${n.height}px`);
  if (n.layoutSizingHorizontal === 'FIXED' || n.layoutSizingHorizontal === 'FILL' || (n.type === 'FRAME' && (!n.layoutMode || n.layoutMode === 'NONE'))) st.push(`width:${n.width}px`, 'flex-shrink:0');
  if (n.fills?.[0]) st.push(`background:${paint(n.fills[0], mode)}`);
  if (n.strokes?.[0] && n.strokeWeight) st.push(`border:${n.strokeWeight}px solid ${paint(n.strokes[0], mode)}`);
  if (n.cornerRadius) st.push(`border-radius:${n.cornerRadius}px`);
  if (n.opacity !== undefined && n.opacity < 1) st.push(`opacity:${n.opacity}`);
  return `<div style="${st.join(';')}">${(n.children ?? []).map((c) => toHtml(c, mode)).join('')}</div>`;
}
async function renderer(node, mode, scale) {
  if (!ctxs[scale]) { ctxs[scale] = await (await browser.newContext({ deviceScaleFactor: scale, viewport: { width: 600, height: 400 } })).newPage(); }
  const pg = ctxs[scale];
  await pg.setContent(`<html><body style="margin:0;background:transparent"><div id="r" style="display:inline-block">${toHtml(node, mode)}</div></body></html>`);
  await pg.evaluate(() => document.fonts.ready);
  const el = await pg.$('#r > div');
  return new Uint8Array(await el.screenshot({ omitBackground: true }));
}

// ---------------------------------------------------------------- run the real plugin code against the mock
const { runPlugin } = buildFigma({ fileName: 'Component Library', pages, collections: [brandCol, primCol], variables, renderer });
const plugin = await runPlugin(readCode(path.join(here, '..', 'figma-plugin', 'code.js')));
await plugin.send({ type: 'init' });
const scanMsgs = await plugin.send({ type: 'scan', options: { scope: 'file' } });
const scan = scanMsgs.find((m) => m.type === 'scan-result')?.result;
assert.ok(scan, `scan failed: ${JSON.stringify(scanMsgs.find((m) => m.type === 'error'))}`);
assert.equal(scan.components, 5, 'scan finds 5 components on ❖ pages (skips Playground, deprecated, _Component)');
assert.equal(scan.suggestedBrandCollection, brandCol.id, 'brand collection auto-detected');
const exportMsgs = await plugin.send({ type: 'export', options: { scope: 'file', brandCollectionId: brandCol.id, renders: true, scale: 2, maxVariants: 40 } });
const err = exportMsgs.find((m) => m.type === 'error');
assert.ok(!err, `export failed: ${err?.message}`);
const manifest = exportMsgs.find((m) => m.type === 'export-result').manifest;
fs.writeFileSync(path.join(OUT, 'figma-manifest.json'), JSON.stringify(manifest));
console.log(`plugin: ${manifest.stats.components} components, ${manifest.stats.variants} variants, ${manifest.stats.renders} renders, ${manifest.stats.variables} tokens`);
assert.equal(manifest.components.find((c) => c.name === 'Button').section, 'ACTIONS');
assert.equal(manifest.variables[V['components/button/radius']].valuesByBrand.Dragonpass, 999, 'alias chain resolved');
assert.ok(!pages[4].children.some((c) => c.name.startsWith('[atom-parity]')), 'temporary render frame removed');
await browser.close();

// ---------------------------------------------------------------- run the CLI pipeline
const cfgFile = path.join(OUT, 'atom-parity.config.json');
fs.writeFileSync(cfgFile, JSON.stringify({
  storybookUrl: STORYBOOK_URL,
  figmaManifest: 'figma-manifest.json',
  outDir: 'report',
  brands: { map: { Dragonpass: 'global-app', MasterCard: 'master-card' } },
  components: { aliases: { Accordion: 'Collapse' } },
  props: { map: { Button: { Size: { arg: 'size', values: { Regular: 'middle' } } } } },
}, null, 2));
const cfg = loadConfig(cfgFile);
const results = await run(cfg, {});
writeReport(results, cfg.outDir, {});
server.close(); await new Promise((r) => setTimeout(r, 50));

// ---------------------------------------------------------------- assertions
const comp = (n) => results.components.find((c) => c.name === n);
const has = (n, pred, msg) => assert.ok(comp(n)?.checks.some(pred), `${n}: expected ${msg}\n${JSON.stringify(comp(n)?.checks.filter((c) => c.status !== 'pass').map((c) => [c.category, c.status, c.title, c.detail]), null, 1)}`);
const S = results.summary;
console.log(`\n${S.score}% · ${S.headline}`);
console.table(results.components.map((c) => ({ name: c.name, status: c.status, score: c.score, fail: c.checks.filter((x) => x.status === 'fail').length, warn: c.checks.filter((x) => x.status === 'warn').length })));

assert.equal(comp('Badge').status, 'Missing in code');
assert.equal(comp('Alert').status, 'Missing in design');
assert.deepEqual(results.brands.pairs.find((p) => p.figma === 'Visa').code, null, 'Visa has no Storybook brand');
assert.ok(results.brands.onlyInCode.includes('investec'));

has('Button', (c) => c.category === 'Properties' && c.subject === 'values:Size' && c.status === 'warn' && /Regular → middle/.test(c.detail), 'Size values named differently');
has('Button', (c) => c.category === 'Visual' && c.subject === 'height' && c.status === 'warn' && c.variants.some((v) => /Small/.test(v)), 'Small height drift (2px is a warning, not breakage)');
has('Button', (c) => c.subject === 'token:Background colour' && c.status === 'warn' && /--aum-button-primary-bg-color/.test(c.detail), 'primary uses component token');
has('Button', (c) => c.subject === 'token:Label · Text colour' && c.status === 'fail' && /hard-coded/.test(c.title), 'destructive label hard-coded');
has('Button', (c) => c.subject === 'value:Background colour' && c.status === 'fail' && c.brands.includes('MasterCard'), 'MasterCard hover colour differs');
has('Button', (c) => c.category === 'Interaction' && c.subject === 'focus' && c.status === 'pass', 'focus indicator present');
has('Button', (c) => c.category === 'Interaction' && c.subject === 'hover' && c.status === 'pass', 'hover present');

has('Tags', (c) => c.category === 'Naming' && c.subject === 'name' && c.status === 'warn', 'plural naming warning');
has('Tags', (c) => c.subject === 'values:Type' && c.status === 'fail' && /Danger/.test(c.detail), 'Danger missing in code');
has('Tags', (c) => /retired/.test(c.title) && /error/.test(c.title), 'retired "error" term in code');
has('Tags', (c) => c.category === 'Accessibility' && c.subject === 'axe:color-contrast' && c.owner === 'Design', 'contrast failure owned by design');
has('Tags', (c) => /isn't linked to a variable in Figma/.test(c.title) && c.owner === 'Design', 'unlinked Info colours in Figma');

has('Accordion', (c) => c.subject === 'name' && c.status === 'fail' && /Collapse/.test(c.title), 'Accordion/Collapse naming failure');
has('Accordion', (c) => c.category === 'Interaction' && c.subject === 'focus' && c.status === 'fail', 'no focus indicator');
has('Switch', (c) => c.category === 'Interaction' && c.subject === 'target' && c.status === 'fail', 'target too small');
has('Switch', (c) => c.category === 'Visual' && c.subject === 'height' && c.status === 'fail', 'switch height differs');

const tokRow = results.tokens.rows.find((r) => r.figma === 'background/interactive/action-hover');
assert.equal(tokRow.brands.MasterCard.status, 'differs', 'token table catches MasterCard hover drift');
assert.equal(results.tokens.rows.find((r) => r.figma === 'typography/body/family').status, 'missing', 'font family token name mismatch');
assert.ok(fs.existsSync(path.join(cfg.outDir, 'index.html')) && fs.existsSync(path.join(cfg.outDir, 'issues.csv')));
const gal = comp('Button').gallery.find((g) => g.figma && g.code && g.diff);
assert.ok(gal && fs.existsSync(path.join(cfg.outDir, gal.diff)), 'gallery images written');

// Baseline delta: a second run against itself reports no new failures
const again = (await import('../src/compare.js')).delta(results, results);
assert.equal(again.newFails.length, 0);
console.log('\n✓ all e2e assertions passed');

// ================================================================ Figma link (REST) mode
// Serve the mock library in Figma REST format and check both modes:
// without a plugin snapshot (structure, values, default-brand visuals) and with one (token names, brands).
const { runAll, addCheck } = await import('../src/site.js');
const WEIGHT = { Regular: 400, Medium: 500, 'Semi Bold': 600, Bold: 700 };
function toRest(n) {
  const o = { id: n.id, name: n.name, type: n.type === 'PAGE' ? 'CANVAS' : n.type };
  if (n.visible === false) o.visible = false;
  for (const k of ['fills', 'strokes', 'strokeWeight', 'cornerRadius', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'layoutMode', 'layoutSizingHorizontal', 'layoutSizingVertical', 'primaryAxisAlignItems', 'counterAxisAlignItems', 'opacity', 'characters', 'componentPropertyDefinitions', 'description']) if (n[k] !== undefined) o[k] = n[k];
  if (n.boundVariables && Object.keys(n.boundVariables).length) o.boundVariables = n.boundVariables;
  if (typeof n.width === 'number') o.absoluteBoundingBox = { x: 0, y: 0, width: n.width, height: n.height };
  if (n.type === 'TEXT') o.style = { fontFamily: n.fontName.family, fontWeight: WEIGHT[n.fontName.style] ?? 400, fontSize: n.fontSize, lineHeightPx: n.lineHeight.unit === 'PIXELS' ? n.lineHeight.value : n.fontSize * 1.2, lineHeightUnit: n.lineHeight.unit === 'PIXELS' ? 'PIXELS' : 'INTRINSIC_%' };
  if (n.children) o.children = n.children.map(toRest);
  return o;
}
const KEY = 'nKc4ep7mNdD5IqFRhNRNlW';
const rendersById = new Map(manifest.components.flatMap((c) => c.variants.map((v) => [v.id, v.renders?.Dragonpass])));
const realFetch = globalThis.fetch;
let figmaCalls = 0;
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.host === 'api.figma.com') {
    figmaCalls++;
    assert.equal(init?.headers?.['X-Figma-Token'], 'test-token');
    if (u.pathname === `/v1/files/${KEY}`) return json({ name: 'Component Library', lastModified: '2026-11-16T09:00:00Z', document: { children: pages.map((p) => ({ id: p.id, name: p.name, type: 'CANVAS' })) } });
    if (u.pathname === `/v1/files/${KEY}/nodes`) { const id = u.searchParams.get('ids'); const pg = pages.find((p) => p.id === id); if (!pg) return json({ nodes: { [id]: null } }); return json({ nodes: { [id]: { document: toRest(pg), styles: {}, components: {}, componentSets: Object.fromEntries(pg.children.filter((c) => c.type === 'COMPONENT_SET').map((c) => [c.id, { key: c.key, name: c.name, description: c.description }])) } } }); }
    if (u.pathname === `/v1/images/${KEY}`) return json({ images: Object.fromEntries(u.searchParams.get('ids').split(',').map((id) => [id, `https://figma-img.test/${encodeURIComponent(id)}.png`])) });
    return new Response('not mocked', { status: 404 });
  }
  if (u.host === 'figma-img.test') {
    const data = rendersById.get(decodeURIComponent(u.pathname.slice(1, -4)));
    return data ? new Response(Buffer.from(data.split(',')[1], 'base64'), { status: 200 }) : new Response('', { status: 404 });
  }
  return realFetch(url, init);
};
process.env.FIGMA_TOKEN = 'test-token';
await new Promise((r) => server.listen(PORT, r));

const restCfg = (extra) => {
  const f = path.join(OUT, `rest-${extra.tag}.config.json`);
  fs.writeFileSync(f, JSON.stringify({
    storybookUrl: STORYBOOK_URL, figmaUrl: `https://www.figma.com/design/${KEY}/Component-Library`,
    figmaManifest: extra.snapshot ?? 'none.json', outDir: `rest-${extra.tag}`,
    figma: { pageDelayMs: 0, imageDelayMs: 0 },
    brands: { map: { Dragonpass: 'global-app', MasterCard: 'master-card' }, figmaBrands: ['Dragonpass', 'MasterCard', 'Visa'] },
    components: { aliases: { Accordion: 'Collapse' } },
    props: { map: { Button: { Size: { arg: 'size', values: { Regular: 'middle' } } } } },
  }));
  return loadConfig(f);
};

// 1. Link only, no plugin snapshot
const r1 = await run(restCfg({ tag: 'link' }), {});
writeReport(r1, path.join(OUT, 'rest-link'), {});
const c1 = (n) => r1.components.find((c) => c.name === n);
console.log(`\nREST without snapshot: ${r1.summary.score}% · ${figmaCalls} Figma API calls`);
assert.equal(r1.meta.figma.source, 'figma-rest');
assert.equal(c1('Button').status !== undefined && c1('Badge').status, 'Missing in code');
assert.ok(c1('Button').gallery.some((g) => g.figma && g.brand === 'Dragonpass'), 'REST renders used for visual diff');
assert.ok(!c1('Button').checks.some((ch) => /isn't linked to a variable/.test(ch.title)), 'bound-but-unnamed variables are not reported as unlinked');
assert.ok(c1('Tags').checks.some((ch) => /isn't linked to a variable/.test(ch.title)), 'truly unlinked colours still reported');
assert.ok(c1('Button').checks.some((ch) => ch.subject === 'value:Background colour' && ch.instances.some((i) => i.brand === 'Dragonpass')), 'default-brand values compared');
assert.equal(r1.tokens.rows.length, 0, 'no token table without snapshot');
assert.ok(c1('Switch').checks.some((ch) => ch.subject === 'target' && ch.status === 'fail'), 'interaction checks still run');

// 2. Link + plugin snapshot: token names and every brand
const r2 = await run(restCfg({ tag: 'snap', snapshot: path.join(OUT, 'figma-manifest.json') }), {});
const c2 = (n) => r2.components.find((c) => c.name === n);
console.log(`REST with snapshot: ${r2.summary.score}%`);
assert.ok(r2.meta.figma.tokenSource, 'token source recorded');
assert.ok(c2('Button').checks.some((ch) => ch.subject === 'value:Background colour' && ch.status === 'fail' && ch.brands.includes('MasterCard')), 'MasterCard drift found via snapshot');
assert.ok(c2('Button').checks.some((ch) => ch.subject === 'token:Background colour' && /--aum-button-primary-bg-color/.test(ch.detail)), 'token names via snapshot');
assert.ok(r2.tokens.rows.length > 10);

// 3. Saved checks → site
const checksFile = path.join(OUT, 'checks.json');
addCheck(checksFile, { name: 'Atom library', figmaUrl: `https://www.figma.com/design/${KEY}/Component-Library?t=abc`, storybookUrl: STORYBOOK_URL });
addCheck(checksFile, { name: 'Broken link', figmaUrl: `https://www.figma.com/design/${KEY}/Component-Library?node-id=999-1`, storybookUrl: STORYBOOK_URL });
const cfgBase = path.join(OUT, 'site.config.json');
fs.writeFileSync(cfgBase, JSON.stringify({ figma: { pageDelayMs: 0, imageDelayMs: 0 }, brands: { map: { Dragonpass: 'global-app', MasterCard: 'master-card' }, figmaBrands: ['Dragonpass', 'MasterCard'] }, components: { aliases: { Accordion: 'Collapse' } } }));
const entries = await runAll({ configFile: cfgBase, checksFile, siteDir: path.join(OUT, 'site'), baselineDir: path.join(OUT, 'site-baseline'), siteUrl: null });
assert.equal(entries.length, 2);
assert.ok(entries[0].ok && entries[0].score > 0, 'first check ran');
assert.ok(!entries[1].ok && /couldn't find|isn't in this file/i.test(entries[1].error), 'bad link explained in plain words');
assert.ok(!JSON.parse(fs.readFileSync(checksFile, 'utf8')).checks[0].figmaUrl.includes('t=abc'), 'tracking params stripped');
assert.ok(fs.existsSync(path.join(OUT, 'site', 'index.html')) && fs.existsSync(path.join(OUT, 'site', entries[0].id, 'index.html')));
server.close(); await new Promise((r) => setTimeout(r, 50));
globalThis.fetch = realFetch;
console.log('✓ Figma-link mode and saved checks passed');
