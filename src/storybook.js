// Storybook crawler: index, argTypes, brand globals, and per-variant renders.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { collect, targetStyles, tokenValues, definedTokens } from './page/collector.js';
import { leaf, log, slug, ensureDir } from './util.js';

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');

// ---------------------------------------------------------------- base URL
/** Accepts a manager URL (…/?path=/story/x), a folder URL, or a direct iframe URL and finds index.json. */
export async function resolveStorybook(inputUrl, headers = {}) {
  const u = new URL(inputUrl);
  u.search = ''; u.hash = '';
  let p = u.pathname.replace(/(iframe|index)\.html$/, '');
  const candidates = [];
  const add = (pathname) => { const c = new URL(u); c.pathname = pathname.endsWith('/') ? pathname : `${pathname}/`; if (!candidates.includes(c.href)) candidates.push(c.href); };
  add(p);
  // "…/atom-ui-mobile/component" with no trailing slash: relative URLs resolve to the parent folder
  while (p.length > 1) { p = p.replace(/\/?[^/]*\/?$/, '') || '/'; add(p); if (p === '/') break; }
  for (const base of candidates) {
    for (const file of ['index.json', 'stories.json']) {
      try {
        const res = await fetch(new URL(file, base), { headers });
        if (!res.ok) continue;
        const text = await res.text();
        if (!text.trim().startsWith('{')) continue;
        const json = JSON.parse(text);
        if (json.entries || json.stories) return { base, index: json, indexFile: file };
      } catch { /* try next */ }
    }
  }
  throw new Error(`Couldn't find a Storybook index.json from ${inputUrl}. Tried: ${candidates.join(', ')}`);
}

export async function launchBrowser(cfg) {
  const opts = { headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'] };
  const tries = [
    () => chromium.launch(opts),
    () => chromium.launch({ ...opts, channel: 'chrome' }),
    () => chromium.launch({ ...opts, executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' }),
  ];
  let lastErr;
  for (const t of tries) { try { return await t(); } catch (e) { lastErr = e; } }
  throw new Error(`Couldn't start Chromium. Run "npx playwright install chromium" or set CHROME_PATH. (${lastErr?.message})`);
}

const DISABLE_MOTION = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}`;

async function newContext(browser, cfg) {
  const context = await browser.newContext({
    viewport: { width: cfg.viewport.width, height: cfg.viewport.height },
    deviceScaleFactor: cfg.viewport.deviceScaleFactor,
    reducedMotion: 'reduce',
    extraHTTPHeaders: cfg.storybook.headers ?? {},
    locale: 'en-GB',
  });
  await context.addInitScript((css) => {
    const add = () => { const s = document.createElement('style'); s.setAttribute('data-ap', ''); s.textContent = css; (document.head || document.documentElement).appendChild(s); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  }, DISABLE_MOTION);
  return context;
}

const globalsParam = (g) => Object.entries(g).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}:${v}`).join(';');

async function waitForPreview(page, timeout) {
  await page.waitForFunction(() => {
    const p = window.__STORYBOOK_PREVIEW__;
    return p && p.storyStoreValue && window.__STORYBOOK_ADDONS_CHANNEL__;
  }, null, { timeout });
}

async function waitForRender(page, timeout) {
  await page.waitForFunction(() => {
    const b = document.body.classList;
    return b.contains('sb-show-errordisplay') || b.contains('sb-show-nopreview') ||
      (b.contains('sb-show-main') && (document.querySelector('#storybook-root, #root')?.childElementCount ?? 0) > 0);
  }, null, { timeout });
  await page.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
}

async function renderError(page) {
  return page.evaluate(() => {
    if (!document.body.classList.contains('sb-show-errordisplay')) return null;
    const el = document.querySelector('#error-message') || document.querySelector('.sb-errordisplay');
    return (el?.textContent || 'Story failed to render').trim().slice(0, 300);
  });
}

// ---------------------------------------------------------------- phase 1: index + metadata
export async function readStorybook(browser, cfg) {
  log.step('Reading Storybook');
  const { base, index } = await resolveStorybook(cfg.storybookUrl, cfg.storybook.headers);
  const entries = Object.values(index.entries ?? index.stories ?? {});
  const stories = entries.filter((e) => (e.type ?? 'story') === 'story');
  log.info(`${base} · ${stories.length} stories in ${new Set(entries.map((e) => e.title)).size} titles`);

  const context = await newContext(browser, cfg);
  const page = await context.newPage();
  await page.goto(`${base}iframe.html?id=${encodeURIComponent(stories[0].id)}&viewMode=story`, { waitUntil: 'domcontentloaded', timeout: cfg.timeoutMs * 2 });
  await waitForPreview(page, cfg.timeoutMs * 2);

  // Globals and project annotations
  const meta = await page.evaluate(() => {
    const S = window.__STORYBOOK_PREVIEW__.storyStoreValue;
    const pa = S.projectAnnotations || {};
    const clean = (v, d = 0) => (v == null || d > 3 ? v ?? null : typeof v === 'function' ? undefined : Array.isArray(v) ? v.slice(0, 40).map((x) => clean(x, d + 1)) : typeof v === 'object' ? Object.fromEntries(Object.entries(v).slice(0, 60).map(([k, x]) => [k, clean(x, d + 1)]).filter(([, x]) => x !== undefined)) : v);
    const globalTypes = {};
    for (const [k, v] of Object.entries(pa.globalTypes || {})) {
      const items = (v.toolbar?.items || v.items || []).map((i) => (typeof i === 'string' ? { value: i, title: i } : { value: i.value, title: i.title || i.value })).filter((i) => i.value !== undefined);
      globalTypes[k] = { description: v.description || v.name || k, items, defaultValue: v.defaultValue };
    }
    return { globalTypes, initialGlobals: clean(pa.initialGlobals || pa.globals || {}), renderer: window.STORYBOOK_RENDERER || null, stories: {} };
  });

  // Load one representative story per component. Loading every CSF file at once
  // (cacheAllCSFFiles) can freeze large Storybooks, so each story gets its own timeout.
  const preferred = (cfg.storybook.preferredStories ?? []).map((n) => n.toLowerCase());
  const byTitleStories = new Map();
  for (const st of stories) { if (!byTitleStories.has(st.title)) byTitleStories.set(st.title, []); byTitleStories.get(st.title).push(st); }
  const reps = [...byTitleStories.values()].map((list) => preferred.map((p) => list.find((x) => x.name.toLowerCase() === p)).find(Boolean) ?? list[0]);
  for (let i = 0; i < reps.length; i += 20) {
    const chunk = reps.slice(i, i + 20).map((r) => r.id);
    const loaded = await page.evaluate(async ({ ids, timeout }) => {
      const S = window.__STORYBOOK_PREVIEW__.storyStoreValue;
      const out = {};
      for (const id of ids) {
        try {
          const st = await Promise.race([S.loadStory({ storyId: id }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout))]);
          const argTypes = {};
          for (const [name, at] of Object.entries(st.argTypes || {})) {
            const tv = at.type && typeof at.type === 'object' ? at.type : null;
            argTypes[name] = {
              type: typeof at.type === 'string' ? at.type : tv?.name,
              control: typeof at.control === 'string' ? at.control : at.control === false ? false : at.control?.type,
              options: Array.isArray(at.options) ? at.options.map((o) => (o !== null && typeof o === 'object' ? JSON.stringify(o) : o)) : (tv?.name === 'enum' && Array.isArray(tv.value) ? tv.value : undefined),
              defaultValue: at.table?.defaultValue?.summary ?? at.defaultValue,
              action: !!at.action,
            };
          }
          const args = JSON.parse(JSON.stringify(st.initialArgs || {}, (k, v) => (typeof v === 'function' ? undefined : v && v.$$typeof ? '[element]' : v)));
          out[id] = { id, title: st.title, name: st.name, args, argTypes };
        } catch (e) { out[id] = { id, error: String(e.message || e).slice(0, 200) }; }
      }
      return out;
    }, { ids: chunk, timeout: Math.min(cfg.timeoutMs, 10000) });
    Object.assign(meta.stories, loaded);
  }
  const failed = Object.values(meta.stories).filter((m) => m.error);
  if (failed.length) log.warn(`${failed.length} stories couldn't be loaded for metadata: ${failed.slice(0, 5).map((f) => f.id).join(', ')}`);
  await context.close();

  // Group stories into components (one per title)
  const ignore = (cfg.storybook.ignoreTitles ?? []).map((p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i'));
  const byTitle = new Map();
  for (const e of entries) {
    if (ignore.some((r) => r.test(e.title))) continue;
    if (!byTitle.has(e.title)) byTitle.set(e.title, { title: e.title, name: leaf(e.title), group: e.title.includes('/') ? e.title.split('/')[0].trim() : null, stories: [], hasDocs: false, importPath: e.importPath });
    const c = byTitle.get(e.title);
    if ((e.type ?? 'story') === 'docs') { c.hasDocs = true; continue; }
    const m = meta.stories[e.id];
    c.stories.push({ id: e.id, name: e.name, args: m?.args ?? {}, argTypes: m?.argTypes ?? {}, loaded: !!m && !m.error, loadError: m?.error ?? null });
  }
  const components = [...byTitle.values()].map((c) => {
    const argTypes = {};
    c.stories.forEach((s) => Object.entries(s.argTypes).forEach(([k, v]) => { if (!argTypes[k]) argTypes[k] = v; }));
    return { ...c, argTypes };
  });

  // Brand global
  const gt = meta.globalTypes;
  let brandGlobal = cfg.brands.global;
  if (!brandGlobal) brandGlobal = Object.keys(gt).find((k) => /^(biz|brand|brands|theme|tenant|client|white-?label)$/i.test(k) && gt[k].items.length > 1) ?? null;
  const brands = brandGlobal && gt[brandGlobal] ? gt[brandGlobal].items : [];
  log.info(`${components.length} components · brand global: ${brandGlobal ?? 'none'}${brands.length ? ` (${brands.map((b) => b.value).join(', ')})` : ''}`);

  return { base, url: cfg.storybookUrl, renderer: meta.renderer, globalTypes: gt, initialGlobals: meta.initialGlobals, brandGlobal, brands, components };
}

// ---------------------------------------------------------------- phase 2: renders
/**
 * jobs: [{ key, storyId, brandCode, args, interaction, figmaSize, a11y, interactionProbe, label }]
 * Jobs are grouped by story+brand so each group needs one page load; variants are applied
 * through Storybook's channel (updateStoryArgs) instead of reloading.
 */
export async function runRenders(browser, sb, jobs, cfg, assetsDir, onProgress) {
  ensureDir(path.join(assetsDir, 'code'));
  const groups = new Map();
  for (const j of jobs) {
    const k = `${j.storyId}|${j.brandCode ?? ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(j);
  }
  const groupList = [...groups.values()];
  const results = {};
  let done = 0;

  const context = await newContext(browser, cfg);
  const workers = Array.from({ length: Math.max(1, Math.min(cfg.concurrency, groupList.length)) }, async () => {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => consoleErrors.push(String(e.message || e).slice(0, 300)));
    while (groupList.length) {
      const group = groupList.shift();
      await runGroup(page, sb, group, cfg, assetsDir, results, consoleErrors).catch((e) => {
        group.forEach((j) => { results[j.key] = results[j.key] ?? { ok: false, error: `Crawler error: ${e.message.split('\n')[0]}` }; });
      });
      done += group.length;
      onProgress?.(done, jobs.length);
    }
    await page.close();
  });
  await Promise.all(workers);
  await context.close();
  return results;
}

async function runGroup(page, sb, group, cfg, assetsDir, results, consoleErrors) {
  const first = group[0];
  const globals = { ...(cfg.brands.extraGlobals ?? {}) };
  if (sb.brandGlobal && first.brandCode) globals[sb.brandGlobal] = first.brandCode;
  const url = `${sb.base}iframe.html?id=${encodeURIComponent(first.storyId)}&viewMode=story${Object.keys(globals).length ? `&globals=${encodeURIComponent(globalsParam(globals))}` : ''}`;

  consoleErrors.length = 0;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: cfg.timeoutMs * 2 });
  await waitForPreview(page, cfg.timeoutMs);
  await waitForRender(page, cfg.timeoutMs).catch(() => {});
  const loadErr = await renderError(page);
  const loadConsole = [...consoleErrors];
  await page.addScriptTag({ path: AXE_PATH }).catch(() => {});

  let currentArgs = null;
  for (const job of group) {
    consoleErrors.length = 0;
    const res = { url, storyId: job.storyId, brand: job.brandCode, args: job.args, interaction: job.interaction ?? null };
    try {
      if (loadErr) throw Object.assign(new Error(loadErr), { render: true });

      // Apply args through the channel
      const argsKey = JSON.stringify(job.args ?? {});
      if (job.args && Object.keys(job.args).length && argsKey !== currentArgs) {
        await page.evaluate(({ storyId, args, timeout }) => new Promise((resolve) => {
          const ch = window.__STORYBOOK_ADDONS_CHANNEL__;
          const finish = (r) => { clearTimeout(t); ch.off('storyRendered', ok); ch.off('storyErrored', bad); ch.off('storyThrewException', bad); resolve(r); };
          const ok = () => finish('rendered'); const bad = () => finish('error');
          const t = setTimeout(() => finish('timeout'), timeout);
          ch.on('storyRendered', ok); ch.on('storyErrored', bad); ch.on('storyThrewException', bad);
          ch.emit('updateStoryArgs', { storyId, updatedArgs: args });
        }), { storyId: job.storyId, args: job.args, timeout: Math.min(cfg.timeoutMs, 6000) });
        currentArgs = argsKey;
        await waitForRender(page, cfg.timeoutMs).catch(() => {});
      }
      const err = await renderError(page);
      if (err) throw Object.assign(new Error(err), { render: true });

      // Size the story container like the Figma frame when the design fills its parent
      await page.evaluate((fs) => {
        const r = document.querySelector('#storybook-root') || document.querySelector('#root');
        if (!r) return;
        r.style.width = fs && fs.sizingH === 'FILL' && fs.width ? `${fs.width}px` : '';
      }, job.figmaSize ?? null);
      await page.mouse.move(0, 0);
      await page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });

      // Interaction probe: rest → hover → keyboard focus on the first interactive element
      let collected = await page.evaluate(collect, { tokenPrefix: cfg.tokens.cssVarPrefix, figmaSize: job.figmaSize, rootSelector: job.rootSelector });
      if (!collected.ok) throw Object.assign(new Error(collected.error), { render: true });

      if (job.interactionProbe && collected.hasTarget) {
        const target = page.locator('[data-ap-target]').first();
        const rest = await page.evaluate(targetStyles);
        let hover = null; let focus = null;
        try { await target.hover({ timeout: 2000, force: true }); hover = await page.evaluate(targetStyles); } catch { /* not hoverable */ }
        await page.mouse.move(0, 0);
        try {
          await page.evaluate(() => document.activeElement?.blur?.());
          for (let i = 0; i < 25; i++) {
            await page.keyboard.press('Tab');
            const inside = await page.evaluate(() => { const t = document.querySelector('[data-ap-target]'); return !!t && (document.activeElement === t || t.contains(document.activeElement)); });
            if (inside) { focus = await page.evaluate(targetStyles); break; }
          }
        } catch { /* not focusable */ }
        await page.evaluate(() => document.activeElement?.blur?.());
        res.probe = { rest, hover, focus, targetRect: collected.targetRect, disabled: collected.targetDisabled };
      }

      // Apply the variant's interaction state before measuring
      if (job.interaction && collected.hasTarget) {
        const target = page.locator('[data-ap-target]').first();
        if (job.interaction === 'hover') await target.hover({ force: true }).catch(() => {});
        if (job.interaction === 'active') { await target.hover({ force: true }).catch(() => {}); await page.mouse.down().catch(() => {}); }
        if (job.interaction === 'focus') {
          for (let i = 0; i < 25; i++) {
            await page.keyboard.press('Tab');
            const inside = await page.evaluate(() => { const t = document.querySelector('[data-ap-target]'); return !!t && (document.activeElement === t || t.contains(document.activeElement)); });
            if (inside) break;
          }
        }
        collected = await page.evaluate(collect, { tokenPrefix: cfg.tokens.cssVarPrefix, figmaSize: job.figmaSize, rootSelector: job.rootSelector });
      }
      res.dom = collected;

      if (job.screenshot !== false) {
        const file = path.join(assetsDir, 'code', `${slug(job.key)}.png`);
        await page.locator('[data-ap-root]').first().screenshot({ path: file, animations: 'disabled', caret: 'hide', timeout: 5000 }).catch(async () => {
          await page.screenshot({ path: file, fullPage: false });
        });
        res.screenshot = path.relative(path.dirname(assetsDir), file);
      }
      if (job.interaction === 'active') await page.mouse.up().catch(() => {});

      if (job.a11y) {
        res.a11y = await page.evaluate(async (tags) => {
          if (!window.axe) return { error: 'axe-core not loaded' };
          const ctx = { include: [['#storybook-root'], ['body > *:not(#storybook-root):not(#storybook-docs):not(script):not(style):not(.sb-wrapper):not(.sb-errordisplay):not(.sb-nopreview):not(.sb-preparing-story):not(.sb-preparing-docs)']] };
          const r = await window.axe.run(ctx, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
          return { violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(' ') ?? '', summary: (v.nodes[0]?.failureSummary ?? '').slice(0, 300) })) };
        }, cfg.a11y.tags).catch((e) => ({ error: e.message }));
      }
      res.ok = true;
    } catch (e) {
      res.ok = false;
      res.error = e.message.split('\n')[0];
      res.renderError = !!e.render;
    }
    res.consoleErrors = [...new Set([...loadConsole, ...consoleErrors])].slice(0, 5);
    results[job.key] = res;
  }
}

// ---------------------------------------------------------------- token values per brand
export async function readTokenValues(browser, sb, cfg, storyId, brandCodes, names) {
  const context = await newContext(browser, cfg);
  const page = await context.newPage();
  const out = {}; let defined = [];
  for (const brand of brandCodes.length ? brandCodes : [null]) {
    const globals = { ...(cfg.brands.extraGlobals ?? {}) };
    if (sb.brandGlobal && brand) globals[sb.brandGlobal] = brand;
    const url = `${sb.base}iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story${Object.keys(globals).length ? `&globals=${encodeURIComponent(globalsParam(globals))}` : ''}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: cfg.timeoutMs * 2 });
      await waitForPreview(page, cfg.timeoutMs);
      await waitForRender(page, cfg.timeoutMs).catch(() => {});
      await page.evaluate(collect, { tokenPrefix: cfg.tokens.cssVarPrefix });
      out[brand ?? 'default'] = await page.evaluate(tokenValues, names);
      if (!defined.length) defined = await page.evaluate(definedTokens, cfg.tokens.cssVarPrefix);
    } catch (e) {
      out[brand ?? 'default'] = { __error: e.message.split('\n')[0] };
    }
  }
  await context.close();
  return { values: out, defined };
}

export function saveFigmaRender(dataUrl, file) {
  if (!dataUrl) return null;
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
}
