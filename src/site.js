import { readIgnores } from './ignores.js';
import { execFileSync } from 'node:child_process';
// Saved checks (checks.json) → one report per check + an index page listing them all.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { run } from './run.js';
import { writeReport } from './report.js';
import { parseFigmaUrl } from './figma-rest.js';
import { readJson, writeJson, slug, log } from './util.js';
import { appHtml, writeClient } from './app.js';

export function readChecks(file) {
  if (!fs.existsSync(file)) return { checks: [] };
  const j = readJson(file);
  return { checks: Array.isArray(j) ? j : j.checks ?? [] };
}

export function addCheck(file, { name, figmaUrl, storybookUrl }) {
  if (!figmaUrl || !storybookUrl) throw new Error('Both a Figma link and a Storybook link are needed.');
  const fu = new URL(figmaUrl.trim()); ['t', 'p', 'm', 'fuid'].forEach((k) => fu.searchParams.delete(k)); figmaUrl = fu.href;
  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
  new URL(storybookUrl.trim());
  const data = readChecks(file);
  const id = slug(name || `figma-${nodeId ?? fileKey}`);
  const existing = data.checks.find((c) => c.id === id || (c.figmaUrl === figmaUrl.trim() && c.storybookUrl === storybookUrl.trim()));
  const entry = { id: existing?.id ?? id, name: name || existing?.name || null, figmaUrl: figmaUrl.trim(), storybookUrl: storybookUrl.trim(), addedAt: existing?.addedAt ?? new Date().toISOString() };
  if (existing) Object.assign(existing, entry); else data.checks.push(entry);
  writeJson(file, data);
  return entry;
}

export function removeCheck(file, id) {
  const data = readChecks(file);
  const before = data.checks.length;
  data.checks = data.checks.filter((c) => c.id !== id);
  writeJson(file, data);
  return before !== data.checks.length;
}

/** After a concurrent run published first: keep their entries, swap in ours for the checks we ran. */
export function mergeStatus({ base, fresh, ids, checksFile, out }) {
  if (!fs.existsSync(checksFile)) throw new Error(`Saved checks file not found: ${checksFile}. Run this from the repository folder or pass --checks.`);
  const read = (f) => { try { return readJson(f).entries ?? []; } catch { return []; } };
  const ours = new Map(read(fresh).filter((e) => ids.includes(e.id)).map((e) => [e.id, e]));
  const theirs = new Map(read(base).map((e) => [e.id, e]));
  const { checks } = readChecks(checksFile);
  const entries = checks.map((c) => ours.get(c.id) ?? theirs.get(c.id) ?? { id: c.id, name: c.name, figmaUrl: c.figmaUrl, storybookUrl: c.storybookUrl, ok: null });
  writeJson(out, { generatedAt: new Date().toISOString(), entries });
  return entries;
}

/** Status for every saved check: this run's entries, plus earlier results for checks that didn't run. */
export function writeSite({ checksFile, siteDir, entries = [], statusFrom, repo }) {
  if (!fs.existsSync(checksFile)) throw new Error(`Saved checks file not found: ${checksFile}. Run this from the repository folder or pass --checks.`);
  const { checks } = readChecks(checksFile);
  let previous = [];
  if (statusFrom && fs.existsSync(statusFrom)) { try { previous = readJson(statusFrom).entries ?? []; } catch { previous = []; } }
  const fresh = new Map(entries.map((e) => [e.id, e]));
  const old = new Map(previous.map((e) => [e.id, e]));
  const merged = checks.map((c) => fresh.get(c.id) ?? (old.get(c.id) ? { ...old.get(c.id), name: c.name ?? old.get(c.id).name, figmaUrl: c.figmaUrl, storybookUrl: c.storybookUrl } : { id: c.id, name: c.name, figmaUrl: c.figmaUrl, storybookUrl: c.storybookUrl, ok: null }));
  fs.mkdirSync(siteDir, { recursive: true });
  writeJson(path.join(siteDir, 'checks-status.json'), { generatedAt: new Date().toISOString(), entries: merged });
  fs.writeFileSync(path.join(siteDir, 'index.html'), appHtml({ repo: repo ?? process.env.GITHUB_REPOSITORY ?? repoFromGit(path.dirname(checksFile)) }));
  writeClient(siteDir);
  fs.writeFileSync(path.join(siteDir, '.nojekyll'), '');
  return merged;
}

export async function runAll({ configFile, checksFile, siteDir, baselineDir, siteUrl, only, statusFrom }) {
  const { checks } = readChecks(checksFile);
  const list = only ? checks.filter((c) => only.includes(c.id)) : checks;
  if (!list.length) throw new Error(`No saved checks to run in ${checksFile}.`);
  fs.mkdirSync(siteDir, { recursive: true });
  let previous = [];
  if (statusFrom && fs.existsSync(statusFrom)) { try { previous = readJson(statusFrom).entries ?? []; } catch { previous = []; } }
  const entries = [];
  for (const c of list) {
    log.step(`Check: ${c.name ?? c.id}`);
    const outDir = path.join(siteDir, c.id);
    const entry = { id: c.id, name: c.name, figmaUrl: c.figmaUrl, storybookUrl: c.storybookUrl, ranAt: new Date().toISOString() };
    for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const cfg = loadConfig(configFile, {
        figmaUrl: c.figmaUrl, storybookUrl: c.storybookUrl, outDir,
        baseline: path.join(baselineDir, c.id, 'results.json'), ...(c.overrides ?? {}),
      });
      cfg.ignores = readIgnores(path.join(path.dirname(checksFile), 'ignores.json')).filter((x) => x.check === c.id);
      const results = await run(cfg, {});
      results.meta.check = { id: c.id, repo: process.env.GITHUB_REPOSITORY ?? safeRepo(path.dirname(checksFile)) };
      writeReport(results, outDir, { reportUrl: siteUrl ? `${siteUrl}/${c.id}/` : null, title: c.name });
      const s = results.summary;
      const prev = previous.find((p) => p.id === c.id);
      const history = [...(prev?.history ?? (prev?.score != null ? [{ at: prev.ranAt, score: prev.score }] : [])), { at: results.meta.generatedAt, score: s.score }].slice(-30);
      const rank = { Broken: 0, Drifted: 1, Aligned: 2 };
      const shown = results.components.filter((x) => x.gallery?.some((g) => g.figma && g.code)).sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3));
      const g = shown[0]?.gallery.find((x) => x.figma && x.code);
      Object.assign(entry, {
        ok: true, name: c.name ?? results.components.find((x) => x.figma)?.figma?.page ?? results.meta.figma.file?.name,
        history,
        preview: g ? { component: shown[0].name, status: shown[0].status, variant: g.variant, brand: g.brand, mismatch: g.mismatch, figma: `${c.id}/${g.figma}`, code: `${c.id}/${g.code}` } : null,
        components: results.components.map((x) => ({ name: x.name, status: x.status, score: x.score })),
        score: s.score, headline: s.headline, counts: s.components, previousScore: results.delta?.previousScore ?? null,
        newFails: results.delta?.newFails?.length ?? 0, fixed: results.delta?.fixed?.length ?? 0, ranAt: results.meta.generatedAt,
        tokenSource: results.meta.figma.tokenSource, themes: s.themes.slice(0, 3).map((t) => t.title), ignored: (s.ignored ?? []).length,
        place: results.meta.figma.place ?? placeFromComponents(results.components),
        a11y: results.a11y ? { ran: results.a11y.ran, total: results.a11y.total, counts: results.a11y.counts, components: results.a11y.components, scans: results.a11y.scans, designChecks: results.a11y.designChecks, top: results.a11y.issues.slice(0, 3).map((i) => ({ title: i.title, impact: i.impact, owner: i.owner })) } : null,
      });
      delete entry.error;
      break;
    } catch (e) {
      log.warn(`${c.id} (attempt ${attempt}): ${e.message}`);
      Object.assign(entry, { ok: false, error: e.message.split('\n')[0] });
      if (attempt === 1) { await new Promise((r) => setTimeout(r, process.env.PARITY_FAST_RETRY ? 1 : 30000)); continue; }
    }
    }
    if (entry.ok === false) {
      // Keep the last good report rather than replacing it with nothing
      const prev = previous.find((p) => p.id === c.id && p.ok);
      const prevDir = path.join(baselineDir, c.id);
      if (prev && fs.existsSync(path.join(prevDir, 'index.html'))) {
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.cpSync(prevDir, outDir, { recursive: true });
        const error = entry.error;
        Object.assign(entry, prev, { name: c.name ?? prev.name, figmaUrl: c.figmaUrl, storybookUrl: c.storybookUrl, ok: true, stale: { at: new Date().toISOString(), error } });
        delete entry.error;
      } else fs.rmSync(outDir, { recursive: true, force: true });
    }
    entries.push(entry);
  }
  writeSite({ checksFile, siteDir, entries, statusFrom });
  fs.writeFileSync(path.join(siteDir, 'summary.md'), entries.map((e) => (e.ok ? `**${e.name}**: ${e.score}%. ${e.headline}${e.newFails ? ` ${e.newFails} new failure(s).` : ''}` : `**${e.name ?? e.id}**: couldn't run. ${e.error}`)).join('\n\n') + '\n');
  return entries;
}


/** owner/repo from the git remote next to the saved checks, so a local publish knows where checks run. */
function repoFromGit(dir) {
  try {
    const url = execFileSync('git', ['-C', dir, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim();
    const m = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
    if (m) return m[1];
  } catch { /* not a git folder */ }
  throw new Error('Could not tell which GitHub repository runs the checks. Set GITHUB_REPOSITORY=owner/repo.');
}

/** Where a check sits in the Figma library when its link wasn't a page or section: from its first component. */
function placeFromComponents(components) {
  const f = components.map((c) => c.figma).filter((x) => x && x.pageOrder != null).sort((a, b) => a.pageOrder - b.pageOrder)[0];
  return f ? { group: f.group ?? null, section: f.section ?? null, order: f.pageOrder } : null;
}

function safeRepo(dir) { try { return repoFromGit(dir); } catch { return null; } }
