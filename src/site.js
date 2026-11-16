// Saved checks (checks.json) → one report per check + an index page listing them all.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { run } from './run.js';
import { writeReport } from './report.js';
import { parseFigmaUrl } from './figma-rest.js';
import { readJson, writeJson, slug, log } from './util.js';
import { appHtml } from './app.js';

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
  const id = slug(name || `${fileKey}-${nodeId ?? 'file'}`);
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

/** Status for every saved check: this run's entries, plus earlier results for checks that didn't run. */
export function writeSite({ checksFile, siteDir, entries = [], statusFrom, repo }) {
  const { checks } = readChecks(checksFile);
  let previous = [];
  if (statusFrom && fs.existsSync(statusFrom)) { try { previous = readJson(statusFrom).entries ?? []; } catch { previous = []; } }
  const fresh = new Map(entries.map((e) => [e.id, e]));
  const old = new Map(previous.map((e) => [e.id, e]));
  const merged = checks.map((c) => fresh.get(c.id) ?? (old.get(c.id) ? { ...old.get(c.id), name: c.name ?? old.get(c.id).name, figmaUrl: c.figmaUrl, storybookUrl: c.storybookUrl } : { id: c.id, name: c.name, figmaUrl: c.figmaUrl, storybookUrl: c.storybookUrl, ok: null }));
  fs.mkdirSync(siteDir, { recursive: true });
  writeJson(path.join(siteDir, 'checks-status.json'), { generatedAt: new Date().toISOString(), entries: merged });
  fs.writeFileSync(path.join(siteDir, 'index.html'), appHtml({ repo: repo ?? process.env.GITHUB_REPOSITORY ?? null }));
  fs.writeFileSync(path.join(siteDir, '.nojekyll'), '');
  return merged;
}

export async function runAll({ configFile, checksFile, siteDir, baselineDir, siteUrl, only, statusFrom }) {
  const { checks } = readChecks(checksFile);
  const list = only ? checks.filter((c) => only.includes(c.id)) : checks;
  if (!list.length) throw new Error(`No saved checks to run in ${checksFile}.`);
  fs.mkdirSync(siteDir, { recursive: true });
  const entries = [];
  for (const c of list) {
    log.step(`Check: ${c.name ?? c.id}`);
    const outDir = path.join(siteDir, c.id);
    const entry = { id: c.id, name: c.name, figmaUrl: c.figmaUrl, storybookUrl: c.storybookUrl, ranAt: new Date().toISOString() };
    try {
      const cfg = loadConfig(configFile, {
        figmaUrl: c.figmaUrl, storybookUrl: c.storybookUrl, outDir,
        baseline: path.join(baselineDir, c.id, 'results.json'), ...(c.overrides ?? {}),
      });
      const results = await run(cfg, {});
      writeReport(results, outDir, { reportUrl: siteUrl ? `${siteUrl}/${c.id}/` : null, title: c.name });
      const s = results.summary;
      Object.assign(entry, {
        ok: true, name: c.name ?? [results.meta.figma.file?.name, results.components.find((x) => x.figma)?.figma?.page].filter(Boolean).join(': '),
        score: s.score, headline: s.headline, counts: s.components, previousScore: results.delta?.previousScore ?? null,
        newFails: results.delta?.newFails?.length ?? 0, fixed: results.delta?.fixed?.length ?? 0, ranAt: results.meta.generatedAt,
        tokenSource: results.meta.figma.tokenSource, themes: s.themes.slice(0, 3).map((t) => t.title),
      });
    } catch (e) {
      log.warn(`${c.id}: ${e.message}`);
      Object.assign(entry, { ok: false, error: e.message.split('\n')[0] });
    }
    entries.push(entry);
  }
  writeSite({ checksFile, siteDir, entries, statusFrom });
  fs.writeFileSync(path.join(siteDir, 'summary.md'), entries.map((e) => (e.ok ? `**${e.name}**: ${e.score}%. ${e.headline}${e.newFails ? ` ${e.newFails} new failure(s).` : ''}` : `**${e.name ?? e.id}**: couldn't run. ${e.error}`)).join('\n\n') + '\n');
  return entries;
}

