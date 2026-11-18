// Pipeline: Figma manifest + Storybook → checks → results.json
import fs from 'node:fs';
import path from 'node:path';
import { readStorybook, runRenders, readTokenValues, launchBrowser, saveFigmaRender } from './storybook.js';
import { matchComponents, matchBrands, matchProps, argsForVariant, pickStory } from './match.js';
import { Checks, scoreOf, statusOf, tokenChecks, visualChecks, a11yChecks, interactionChecks, propertyChecks, componentNamingChecks, tokenTable, delta, CATEGORIES } from './compare.js';
import { compareImages } from './visual.js';
import { designA11yChecks, a11ySummary } from './a11y.js';
import { markIgnored } from './ignores.js';
import { manifestFromFigmaUrl } from './figma-rest.js';
import { readJson, writeJson, ensureDir, slug, log, norm, figmaVarToCss, pool } from './util.js';

export function sampleVariants(variants, cap) {
  if (variants.length <= cap) return variants.slice();
  const def = variants.find((v) => v.isDefault) ?? variants[0];
  const dp = def.props ?? {};
  const dist = (v) => Object.keys(dp).filter((k) => v.props?.[k] !== dp[k]).length;
  const sorted = [...variants].sort((a, b) => dist(a) - dist(b));
  const picked = [def];
  for (const key of Object.keys(dp)) {
    for (const val of new Set(variants.map((v) => v.props?.[key]))) {
      if (picked.length >= cap) break;
      if (picked.some((p) => p.props?.[key] === val)) continue;
      const hit = sorted.find((v) => v.props?.[key] === val && !picked.includes(v));
      if (hit) picked.push(hit);
    }
  }
  for (const v of sorted) { if (picked.length >= cap) break; if (!picked.includes(v)) picked.push(v); }
  return picked;
}

export async function run(cfg, opts = {}) {
  const t0 = Date.now();
  const outDir = cfg.outDir;
  const assets = path.join(outDir, 'assets');
  fs.rmSync(assets, { recursive: true, force: true });
  ensureDir(assets);

  // ------------------------------------------------------------ inputs
  let manifest;
  if (cfg.figmaUrl) {
    manifest = await manifestFromFigmaUrl(cfg.figmaUrl, cfg, { snapshotPath: cfg.figmaManifest, sample: sampleVariants });
  } else {
    log.step('Loading Figma snapshot');
    if (!fs.existsSync(cfg.figmaManifest)) throw new Error(`Figma snapshot not found at ${cfg.figmaManifest}. Add a Figma link, or export a snapshot with the Atom Parity Exporter plugin.`);
    manifest = readJson(cfg.figmaManifest);
  }
  if (!manifest.file?.key && cfg.figmaFileKey) manifest.file = { ...(manifest.file ?? {}), key: cfg.figmaFileKey };
  if (!String(manifest.schema ?? '').startsWith('atom-parity/figma@')) throw new Error('That file is not an Atom Parity Exporter snapshot.');
  // Brands left out of every check (brands.exclude), on both sides: the Figma mode and its Storybook theme
  const excluded = new Set((cfg.brands?.exclude ?? []).map(norm));
  const excludedCode = new Set((cfg.brands?.exclude ?? []).map((b) => cfg.brands?.map?.[b]).filter(Boolean).map(norm));
  const keepCodeBrand = (b) => !excludedCode.has(norm(b.value)) && !excluded.has(norm(b.value)) && !excluded.has(norm(b.title ?? ''));
  if (excluded.size) manifest.brands = manifest.brands.filter((b) => !excluded.has(norm(b)));
  const onlySet = opts.only?.length ? new Set(opts.only.map(norm)) : null;
  const figmaComps = manifest.components.filter((c) => !onlySet || onlySet.has(norm(c.name)));
  log.info(`${manifest.file?.name ?? 'Figma'} · ${figmaComps.length} components · brands: ${manifest.brands.join(', ')} · exported ${manifest.exportedAt}`);

  const browser = await launchBrowser(cfg);
  try {
    const sb = await readStorybook(browser, cfg);
    if (excluded.size) sb.brands = sb.brands.filter(keepCodeBrand);
    const codeComps = sb.components.filter((c) => c.stories.length || c.hasDocs).filter((c) => !onlySet || onlySet.has(norm(c.name)) || figmaComps.some((f) => norm(cfg.components.aliases?.[f.name] ?? '') === norm(c.name)));

    // ---------------------------------------------------------- matching
    log.step('Matching');
    const comp = matchComponents(figmaComps, codeComps, cfg);
    const brandMatch = matchBrands(manifest.brands, sb.brands.map((b) => ({ value: b.value, title: b.title })), cfg);
    let activeBrands = brandMatch.pairs.filter((p) => p.code);
    if (!sb.brandGlobal) activeBrands = [{ figma: manifest.brandCollection?.defaultMode ?? manifest.brands[0], code: null, how: 'single' }];
    const defaultBrand = activeBrands.find((b) => b.figma === manifest.brandCollection?.defaultMode) ?? activeBrands[0];
    log.info(`${comp.pairs.length} paired · ${comp.missingInCode.length} only in Figma · ${comp.missingInDesign.length} only in Storybook`);
    log.info(`brands: ${brandMatch.pairs.map((p) => `${p.figma}→${p.code ?? '∅'}`).join(', ')}${brandMatch.onlyInCode.length ? ` · code only: ${brandMatch.onlyInCode.join(', ')}` : ''}`);

    // ---------------------------------------------------------- plan render jobs
    const jobs = []; const plans = [];
    for (const pair of comp.pairs) {
      const propMatch = matchProps(pair.figma, pair.code, cfg);
      const story = pickStory(pair.code, propMatch, cfg);
      const rendered = pair.figma.variants.filter((v) => Object.keys(v.renders ?? {}).length);
      const pool_ = rendered.length ? rendered : pair.figma.variants;
      const variants = sampleVariants(pool_, cfg.visual.maxVariantsPerComponent);
      const plan = { pair, propMatch, story, variants: [], unmapped: [] };
      if (!story) { plans.push(plan); continue; }
      const designHasState = (kind) => propMatch.props.some((p) => p.how === 'state' && p.values.some((v) => v.interaction === kind));
      plan.designHasHover = designHasState('hover');
      // Figma parts switched on by default that the story can't switch on (e.g. icons): pixels will differ
      plan.visualCaveats = propMatch.props.filter((p) => p.figmaType === 'BOOLEAN' && p.default === true && (!p.codeArg || p.codeType !== 'boolean')).map((p) => p.figma);
      plan.designHasFocus = designHasState('focus');
      let probeAssigned = false;
      for (const v of variants) {
        const { args, interaction, unmapped } = argsForVariant(v, propMatch);
        if (unmapped.length) { plan.unmapped.push({ variant: v.name, unmapped }); continue; }
        const disabled = Object.entries(args).some(([k, val]) => /disabled/i.test(k) && val === true);
        const vplan = { variant: v, args, interaction, disabled, jobs: [] };
        for (const bp of activeBrands) {
          const key = `${pair.figma.id}|${v.id}|${bp.figma}`;
          const probe = !probeAssigned && !interaction && !disabled && bp === defaultBrand && cfg.interaction.enabled;
          if (probe) probeAssigned = true;
          const job = {
            key, storyId: story.id, brandCode: bp.code, brandFigma: bp.figma, args, interaction,
            figmaSize: { width: v.width, height: v.height, sizingH: v.sizing?.h },
            rootSelector: cfg.components.rootSelectors?.[pair.figma.name],
            a11y: cfg.a11y.enabled && !opts.skipA11y && !(cfg.a11y.skipDisabled && disabled) && !interaction,
            interactionProbe: probe, screenshot: true,
          };
          jobs.push(job); vplan.jobs.push(job);
        }
        plan.variants.push(vplan);
      }
      plans.push(plan);
    }
    const orphanPlans = [];
    // A page or selection snapshot only covers part of the library: code components outside it aren't "missing in design".
    const partial = manifest.scope && manifest.scope !== 'file';
    if (partial) log.info(`Snapshot covers one ${manifest.scope}; skipping the "not in Figma" check for ${comp.missingInDesign.length} Storybook components outside it.`);
    for (const m of partial ? [] : comp.missingInDesign) {
      const stories = m.code.stories.slice(0, cfg.storybook.maxStoriesForUnmatched);
      const p = { code: m.code, suggestions: m.suggestions, jobs: [] };
      stories.forEach((s, i) => {
        const job = { key: `code|${m.code.title}|${s.id}`, storyId: s.id, brandCode: defaultBrand?.code ?? null, brandFigma: defaultBrand?.figma, args: null,
          a11y: cfg.a11y.enabled && !opts.skipA11y, interactionProbe: i === 0 && cfg.interaction.enabled, screenshot: true };
        jobs.push(job); p.jobs.push(job);
      });
      orphanPlans.push(p);
    }

    // ---------------------------------------------------------- render
    log.step(`Rendering ${jobs.length} variant × brand combinations`);
    let lastPct = -1;
    const renders = await runRenders(browser, sb, jobs, cfg, assets, (d, total) => {
      const pct = Math.floor((d / total) * 10) * 10;
      if (pct !== lastPct) { lastPct = pct; log.info(`${pct}% (${d}/${total})`); }
    });

    log.step('Reading token values per brand');
    const cssNames = [...new Set(Object.values(manifest.variables ?? {}).filter((v) => v?.name).map((v) => figmaVarToCss(v, cfg.tokens)))];
    const anyStory = plans.find((p) => p.story)?.story?.id ?? codeComps.find((c) => c.stories.length)?.stories[0]?.id;
    const tokenRead = anyStory ? await readTokenValues(browser, sb, cfg, anyStory, activeBrands.map((b) => b.code).filter(Boolean), cssNames) : { values: {}, defined: [] };
    const definedTokens = new Set(tokenRead.defined);

    // ---------------------------------------------------------- visual diff
    const visuals = {};
    if (cfg.visual.enabled && !opts.skipVisual) {
      const visJobs = [];
      for (const plan of plans) for (const vp of plan.variants) for (const job of vp.jobs) {
        const dataUrl = vp.variant.renders?.[job.brandFigma];
        const r = renders[job.key];
        if (dataUrl && r?.ok && r.screenshot) visJobs.push({ job, dataUrl, r });
      }
      log.step(`Comparing ${visJobs.length} renders pixel by pixel`);
      await pool(visJobs, 4, async ({ job, dataUrl, r }) => {
        const s = slug(job.key);
        const figmaFile = saveFigmaRender(dataUrl, path.join(assets, 'figma', `${s}.png`));
        try {
          visuals[job.key] = await compareImages(figmaFile, path.join(outDir, r.screenshot), path.join(assets, 'diff', `${s}.png`), {
            figmaScale: manifest.renderScale ?? 2, codeScale: cfg.viewport.deviceScaleFactor,
          });
          visuals[job.key].images = { figma: path.relative(outDir, figmaFile), code: r.screenshot, diff: path.relative(outDir, path.join(assets, 'diff', `${s}.png`)) };
        } catch (e) { visuals[job.key] = { error: e.message }; }
      });
    }

    // ---------------------------------------------------------- checks per component
    log.step('Comparing');
    const components = [];
    for (const plan of plans) {
      const { pair, propMatch } = plan;
      const checks = new Checks();
      componentNamingChecks(checks, { pair, cfg });
      propertyChecks(checks, { pair, propMatch, codeComp: pair.code, cfg });
      if (!plan.story) {
        checks.add({ category: 'Rendering', subject: 'render', label: 'Stories', status: 'fail', owner: 'Dev', title: 'Docs only: no story to render', detail: `${pair.code.title} has a docs page but no stories` });
      }
      if (plan.unmapped.length) {
        const total = plan.unmapped.length + plan.variants.length;
        checks.add({ category: 'Properties', subject: 'coverage', label: 'Variant coverage', status: 'warn', owner: 'Both',
          title: `${plan.unmapped.length} of ${total} variants can't be shown in code`,
          detail: [...new Set(plan.unmapped.flatMap((u) => u.unmapped))].slice(0, 12).join(', ') });
      }
      const gallery = [];
      let probe = null;
      for (const vp of plan.variants) {
        for (const job of vp.jobs) {
          const r = renders[job.key] ?? { ok: false, error: 'Not rendered' };
          const ctx = { brand: job.brandFigma, variant: vp.variant.name };
          if (!r.ok) {
            checks.add({ category: 'Rendering', subject: 'render', label: 'Story renders', status: r.renderError ? 'fail' : 'warn', owner: 'Dev',
              title: r.renderError ? 'Story fails to render' : "Couldn't measure this variant", detail: r.error, ...ctx });
            continue;
          }
          checks.add({ category: 'Rendering', subject: 'render', label: 'Story renders', status: 'pass', owner: 'Dev', title: 'Renders without errors', ...ctx });
          if (r.consoleErrors?.length) checks.add({ category: 'Rendering', subject: 'console', label: 'Console', status: 'warn', owner: 'Dev', title: 'Console errors while rendering', detail: r.consoleErrors[0], ...ctx });
          const vis = visuals[job.key];
          const hasVisual = !!(vis && !vis.error);
          tokenChecks(checks, { variant: vp.variant, figmaBrand: job.brandFigma, codeBrand: job.brandCode, dom: r.dom, variables: manifest.variables ?? {}, cfg, definedTokens, hasVisual, defaultBrand: defaultBrand?.figma });
          if (hasVisual) visualChecks(checks, { variant: vp.variant, figmaBrand: job.brandFigma, vis, cfg, images: vis.images, sizing: vp.variant.sizing, hasText: vp.variant.layers?.some((l) => l.type === 'TEXT'), caveats: plan.visualCaveats });
          if (r.a11y) a11yChecks(checks, { result: r.a11y, brand: job.brandFigma, variant: vp.variant.name, cfg });
          if (r.probe) probe = r.probe;
          gallery.push({
            variant: vp.variant.name, brand: job.brandFigma, interaction: vp.interaction,
            figma: vis?.images?.figma ?? null, code: r.screenshot ?? null, diff: vis?.images?.diff ?? null,
            mismatch: vis?.mismatch ?? null, sizeDelta: vis?.sizeDelta ?? null, figmaSize: vis?.figmaSize ?? null, codeSize: vis?.codeSize ?? null,
            storyUrl: `${sb.base}?path=/story/${job.storyId}`,
          });
        }
      }
      if (probe) interactionChecks(checks, { probe, designHasHover: plan.designHasHover, designHasFocus: plan.designHasFocus, cfg, brand: defaultBrand?.figma });
      if (probe && !probe.disabled && !plan.designHasFocus) {
        checks.add({ category: 'Accessibility', subject: 'design:focus-state', label: 'Focus state in Figma', status: 'warn', owner: 'Design', title: 'No Focus state in Figma',
          detail: 'The component can take keyboard focus, but the Figma component set has no Focus variant', meta: { rule: 'design-focus', source: 'design', impact: 'moderate' } });
      }
      for (const v of pair.figma.variants) designA11yChecks(checks, { variant: v, brands: manifest.brands, variables: manifest.variables ?? {}, defaultBrand: defaultBrand?.figma ?? manifest.brands[0] });
      const list = markIgnored(checks.list(), pair.figma.id, cfg.ignores);
      components.push({
        key: pair.figma.id, name: pair.figma.name, status: statusOf(list), score: scoreOf(list), match: pair.how,
        figma: { id: pair.figma.id, name: pair.figma.name, page: pair.figma.page, section: pair.figma.section, group: pair.figma.group ?? null, order: manifest.components.indexOf(pair.figma), pageOrder: pair.figma.pageOrder ?? null, variants: pair.figma.variants.length, url: manifest.file?.key ? `https://www.figma.com/design/${manifest.file.key}/?node-id=${pair.figma.id.replace(':', '-')}` : null },
        code: { title: pair.code.title, stories: pair.code.stories.length, story: plan.story?.id ?? null, url: plan.story ? `${sb.base}?path=/story/${plan.story.id}` : null },
        props: propMatch, checks: list, gallery: gallery.sort((a, b) => (b.mismatch ?? -1) - (a.mismatch ?? -1)).slice(0, 48),
        rendered: plan.variants.length, unmapped: plan.unmapped.length,
      });
    }
    for (const m of comp.missingInCode) {
      const checks = new Checks();
      for (const v of m.figma.variants) designA11yChecks(checks, { variant: v, brands: manifest.brands, variables: manifest.variables ?? {}, defaultBrand: defaultBrand?.figma ?? manifest.brands[0] });
      checks.add({ category: 'Naming', subject: 'name', label: 'Component', status: 'fail', owner: 'Both', title: 'Not found in Storybook',
        detail: m.suggestions.length ? `Possible matches: ${m.suggestions.map((s) => s.title).join(', ')}. Rename it, or add it to components.aliases.` : 'No similar component in Storybook' });
      const mlist = markIgnored(checks.list(), m.figma.id, cfg.ignores);
      // Ignoring "Not found in Storybook" takes the component out of this check (not meant for the component library)
      const skipped = mlist.some((c) => c.key === 'Naming|name' && c.status === 'ignored');
      components.push({ key: m.figma.id, name: m.figma.name, status: skipped ? 'Ignored' : 'Missing in code', score: skipped ? null : 0, match: null, suggestions: m.suggestions,
        figma: { id: m.figma.id, name: m.figma.name, page: m.figma.page, section: m.figma.section, group: m.figma.group ?? null, order: manifest.components.indexOf(m.figma), pageOrder: m.figma.pageOrder ?? null, variants: m.figma.variants.length, url: manifest.file?.key ? `https://www.figma.com/design/${manifest.file.key}/?node-id=${m.figma.id.replace(':', '-')}` : null },
        code: null, checks: mlist, gallery: [] });
    }
    for (const p of orphanPlans) {
      const checks = new Checks();
      checks.add({ category: 'Naming', subject: 'name', label: 'Component', status: 'warn', owner: 'Design', title: 'Not in the Figma library',
        detail: p.suggestions.length ? `Possible matches: ${p.suggestions.map((s) => s.name).join(', ')}` : 'Undocumented in design, or a code-only helper' });
      const gallery = []; let probe = null;
      for (const job of p.jobs) {
        const r = renders[job.key] ?? { ok: false };
        if (!r.ok) { checks.add({ category: 'Rendering', subject: 'render', label: 'Story renders', status: r.renderError ? 'fail' : 'warn', owner: 'Dev', title: r.renderError ? 'Story fails to render' : "Couldn't measure", detail: r.error, variant: job.storyId }); continue; }
        checks.add({ category: 'Rendering', subject: 'render', label: 'Story renders', status: 'pass', owner: 'Dev', title: 'Renders without errors', variant: job.storyId });
        if (r.a11y) a11yChecks(checks, { result: r.a11y, brand: job.brandFigma, variant: job.storyId, cfg });
        if (r.probe && !probe) probe = r.probe;
        gallery.push({ variant: job.storyId, brand: job.brandFigma, code: r.screenshot, storyUrl: `${sb.base}?path=/story/${job.storyId}` });
      }
      if (probe) interactionChecks(checks, { probe, designHasHover: false, designHasFocus: false, cfg, brand: defaultBrand?.figma });
      components.push({ key: `code:${p.code.title}`, name: p.code.name, status: 'Missing in design', score: null, match: null, suggestions: p.suggestions,
        figma: null, code: { title: p.code.title, stories: p.code.stories.length, url: p.code.stories[0] ? `${sb.base}?path=/story/${p.code.stories[0].id}` : null }, checks: checks.list(), gallery });
    }

    // ---------------------------------------------------------- summary
    const tokens = tokenTable({ manifest, brandPairs: activeBrands, tokenRead, cfg });
    const results = {
      schema: 'atom-parity/results@1',
      meta: {
        generatedAt: new Date().toISOString(), durationMs: Date.now() - t0,
        storybook: { url: cfg.storybookUrl, base: sb.base, brandGlobal: sb.brandGlobal, brands: sb.brands, renderer: sb.renderer, components: codeComps.length },
        figma: { file: manifest.file, exportedAt: manifest.exportedAt, exportedBy: manifest.exportedBy, brands: manifest.brands, components: figmaComps.length, renderScale: manifest.renderScale, source: manifest.source ?? 'plugin', url: manifest.figmaUrl ?? null, scope: manifest.scope ?? 'file', scopeLabel: manifest.scopeLabel ?? null, place: manifest.place ?? null, tokenSource: manifest.tokenSource ?? (manifest.source ? null : { exportedAt: manifest.exportedAt, stale: false }) },
        jobs: jobs.length, viewport: cfg.viewport, only: opts.only ?? null, figmaScope: manifest.scope ?? 'file',
      },
      brands: { pairs: brandMatch.pairs, onlyInCode: brandMatch.onlyInCode, default: defaultBrand?.figma ?? null },
      tokens,
      components: components.sort((a, b) => a.name.localeCompare(b.name)),
    };
    results.summary = summarise(results);
    results.a11y = a11ySummary(results.components);
    if (cfg.baseline && fs.existsSync(cfg.baseline)) {
      try { results.delta = delta(results, readJson(cfg.baseline)); } catch (e) { log.warn(`Baseline unreadable: ${e.message}`); }
    }
    writeJson(path.join(outDir, 'results.json'), results);
    return results;
  } finally {
    await browser.close().catch(() => {});
  }
}

export function summarise(results) {
  const comps = results.components;
  const designComps = comps.filter((c) => c.status !== 'Missing in design' && c.status !== 'Ignored');
  const count = (s) => comps.filter((c) => c.status === s).length;
  const scored = designComps.map((c) => c.score ?? 0);
  const score = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0;

  const byCategory = Object.fromEntries(CATEGORIES.map((k) => [k, { pass: 0, warn: 0, fail: 0 }]));
  const byOwner = { Design: { warn: 0, fail: 0 }, Dev: { warn: 0, fail: 0 }, Both: { warn: 0, fail: 0 } };
  const issues = []; const ignored = [];
  for (const c of comps) {
    for (const ch of c.checks) {
      if (ch.status === 'ignored') { ignored.push({ component: c.name, componentKey: c.key, key: ch.key, category: ch.category, title: ch.title, was: ch.was, owner: ch.owner, reason: ch.ignored?.reason ?? null, at: ch.ignored?.at ?? null, by: ch.ignored?.by ?? null, github: ch.ignored?.github ?? null }); continue; }
      if (byCategory[ch.category] && ch.status !== 'info') byCategory[ch.category][ch.status]++;
      if ((ch.status === 'fail' || ch.status === 'warn') && byOwner[ch.owner]) byOwner[ch.owner][ch.status]++;
      if (ch.status === 'fail' || ch.status === 'warn') issues.push({ component: c.name, componentKey: c.key, key: ch.key, category: ch.category, subject: ch.subject, status: ch.status, title: ch.title, detail: ch.detail, owner: ch.owner, brands: ch.brands, variants: ch.variants.length });
    }
  }
  // Most common problems across the library (same title in many components)
  const themes = new Map();
  const THEME = [
    [/^name$/, (i) => (i.status === 'fail' && /Not found/.test(i.title) ? 'Not built in Storybook' : /Not in the Figma/.test(i.title) ? 'In Storybook but not in Figma' : 'Component named differently in Figma and Storybook')],
    [/^prop:/, (i) => (i.category === 'Naming' ? 'Property named differently in Figma and code' : i.status === 'fail' ? 'Figma property missing in code' : 'State values without a code equivalent')],
    [/^values:/, (i) => (i.status === 'fail' ? 'Property values missing in code' : 'Property values differ')],
    [/^default:/, () => 'Default values differ'],
    [/^retired/, () => 'Retired terms still in use'],
    [/^taxonomy/, () => 'Semantic values filed under State'],
    [/^option:/, () => 'Vague property names'],
  ];
  const themeTitle = (i) => { const hit = THEME.find(([re]) => re.test(i.subject ?? '')); return hit ? hit[1](i) : i.title.replace(/"[^"]*"/g, '').replace(/\s+/g, ' ').trim(); };
  for (const i of issues) {
    const t0 = themeTitle(i);
    const k = `${i.category}|${t0}`;
    if (!themes.has(k)) themes.set(k, { category: i.category, title: t0, status: i.status, owner: i.owner, components: new Set(), items: [] });
    const t = themes.get(k); t.components.add(i.component); if (i.status === 'fail') t.status = 'fail';
    t.items.push({ component: i.componentKey, key: i.key, title: i.title, componentName: i.component });
  }
  const themeList = [...themes.values()].map((t) => ({ ...t, components: [...t.components] }))
    .sort((a, b) => (b.status === 'fail') - (a.status === 'fail') || b.components.length - a.components.length).slice(0, 10);

  const aligned = comps.filter((c) => c.status === 'Aligned').map((c) => c.name);
  const broken = comps.filter((c) => c.status === 'Broken');
  const tk = results.tokens.summary;
  const works = [];
  if (aligned.length) works.push(`${aligned.length} component${aligned.length === 1 ? '' : 's'} fully aligned: ${aligned.slice(0, 8).join(', ')}${aligned.length > 8 ? '…' : ''}`);
  if (tk.total) works.push(`${tk.match} of ${tk.total} design tokens have the same value in code across every brand`);
  const passingCats = Object.entries(byCategory).filter(([, v]) => v.pass + v.warn + v.fail > 0 && v.fail === 0).map(([k]) => k);
  if (passingCats.length) works.push(`No failures in: ${passingCats.join(', ')}`);
  const renderedOk = comps.filter((c) => c.checks.some((ch) => ch.category === 'Rendering' && ch.status === 'pass')).length;
  if (renderedOk) works.push(`${renderedOk} components render in Storybook without errors`);

  const paired = comps.filter((c) => c.match).length;
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const parts = [[count('Drifted'), 'has drifted', 'have drifted'], [count('Broken'), 'is broken', 'are broken'], [count('Missing in code'), "isn't built yet", "aren't built yet"]].filter(([k]) => k > 0).map(([k, a, b]) => n(k, a, b));
  const tail = parts.length ? ` ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0]}.` : '';
  const headline = `${count('Aligned')} of ${designComps.length} Figma components match Storybook.${tail}`;

  return {
    score, headline,
    components: { total: comps.length, figma: designComps.length, paired, aligned: count('Aligned'), drifted: count('Drifted'), broken: count('Broken'), missingInCode: count('Missing in code'), missingInDesign: count('Missing in design'), ignored: count('Ignored') },
    checks: { pass: issues.length ? comps.reduce((n, c) => n + c.checks.filter((x) => x.status === 'pass').length, 0) : comps.reduce((n, c) => n + c.checks.length, 0), warn: issues.filter((i) => i.status === 'warn').length, fail: issues.filter((i) => i.status === 'fail').length },
    byCategory, byOwner, themes: themeList, works, ignored,
    brokenComponents: broken.map((c) => ({ name: c.name, key: c.key, reasons: c.checks.filter((x) => x.status === 'fail' && ['Visual', 'Accessibility', 'Interaction', 'Rendering'].includes(x.category)).map((x) => x.title).slice(0, 3) })),
    issues,
  };
}
