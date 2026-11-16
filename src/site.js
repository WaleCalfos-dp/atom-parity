// Saved checks (checks.json) → one report per check + an index page listing them all.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { run } from './run.js';
import { writeReport } from './report.js';
import { parseFigmaUrl } from './figma-rest.js';
import { readJson, writeJson, slug, log } from './util.js';

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

export async function runAll({ configFile, checksFile, siteDir, baselineDir, siteUrl, only }) {
  const { checks } = readChecks(checksFile);
  const list = only ? checks.filter((c) => only.includes(c.id)) : checks;
  if (!list.length) throw new Error(`No saved checks in ${checksFile}. Add one with a Figma link and a Storybook link.`);
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
      writeReport(results, outDir, { reportUrl: siteUrl ? `${siteUrl}/${c.id}/` : null });
      const s = results.summary;
      Object.assign(entry, {
        ok: true, name: c.name ?? [results.meta.figma.file?.name, results.components.find((x) => x.figma)?.figma?.page].filter(Boolean).join(': '),
        score: s.score, headline: s.headline, counts: s.components, previousScore: results.delta?.previousScore ?? null,
        newFails: results.delta?.newFails?.length ?? 0, fixed: results.delta?.fixed?.length ?? 0,
        tokenSource: results.meta.figma.tokenSource, themes: s.themes.slice(0, 3).map((t) => t.title),
      });
    } catch (e) {
      log.warn(`${c.id}: ${e.message}`);
      Object.assign(entry, { ok: false, error: e.message.split('\n')[0] });
    }
    entries.push(entry);
  }
  writeJson(path.join(siteDir, 'checks-status.json'), { generatedAt: new Date().toISOString(), entries });
  fs.writeFileSync(path.join(siteDir, 'index.html'), indexHtml(entries, { repo: process.env.GITHUB_REPOSITORY ?? null }));
  fs.writeFileSync(path.join(siteDir, 'summary.md'), entries.map((e) => (e.ok ? `**${e.name}**: ${e.score}%. ${e.headline}${e.newFails ? ` ${e.newFails} new failure(s).` : ''}` : `**${e.name ?? e.id}**: couldn't run. ${e.error}`)).join('\n\n') + '\n');
  return entries;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function indexHtml(entries, { repo }) {
  const when = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const runUrl = repo ? `https://github.com/${repo}/actions/workflows/atom-parity.yml` : null;
  const card = (e) => {
    if (!e.ok) {
      return `<article class="card err"><h2>${esc(e.name ?? e.id)}</h2><p class="why">This check couldn't run: ${esc(e.error)}</p>
        <p class="links"><a href="${esc(e.figmaUrl)}">Figma</a><a href="${esc(e.storybookUrl)}">Storybook</a></p></article>`;
    }
    const d = e.previousScore != null ? e.score - e.previousScore : null;
    const c = e.counts;
    return `<article class="card">
      <div class="top"><h2><a href="${esc(e.id)}/">${esc(e.name)}</a></h2><p class="score">${e.score}%${d != null && d !== 0 ? `<small class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</small>` : ''}</p></div>
      <p class="head">${esc(e.headline)}</p>
      <ul class="counts">
        <li class="s-a">${c.aligned} aligned</li><li class="s-d">${c.drifted} drifted</li><li class="s-b">${c.broken} broken</li><li class="s-n">${c.missingInCode} not built</li>
      </ul>
      ${e.themes?.length ? `<p class="themes">Biggest issues: ${esc(e.themes.join('; '))}</p>` : ''}
      ${e.newFails ? `<p class="new">${e.newFails} new problem${e.newFails === 1 ? '' : 's'} since the last run</p>` : ''}
      ${!e.tokenSource ? '<p class="note">Token names aren\'t checked: export a snapshot with the Figma plugin to add them.</p>' : e.tokenSource.stale ? `<p class="note">Token data comes from a plugin snapshot of ${esc(new Date(e.tokenSource.exportedAt).toLocaleDateString('en-GB'))}. The library has changed since, so re-export it when you can.</p>` : ''}
      <p class="links"><a class="primary" href="${esc(e.id)}/">Open report</a><a href="${esc(e.figmaUrl)}">Figma</a><a href="${esc(e.storybookUrl)}">Storybook</a></p>
    </article>`;
  };
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atom parity</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&display=swap" rel="stylesheet">
<style>
:root{--ink:#0A2333;--ink-3:#6B7780;--line:#E3E0DE;--page:#FAF8F7;--blue:#006B99;--ok:#1B7A4E;--warn:#A35F00;--bad:#C2082A}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
header{background:var(--ink);color:#fff}header div,main{max-width:980px;margin-inline:auto;padding-inline:24px}
header div{padding-block:28px}header h1{font:600 26px/1.2 Poppins,sans-serif;margin:0}header p{margin:6px 0 0;color:#B9C4CC}
main{padding-block:32px 64px}a{color:var(--blue)}:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.grid{display:grid;gap:16px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:22px 24px}
.card.err{border-color:#F0B8C1}.why{color:var(--bad)}
.top{display:flex;justify-content:space-between;gap:16px;align-items:baseline}
.card h2{font:600 19px/1.3 Poppins,sans-serif;margin:0}.card h2 a{color:inherit;text-decoration:none}.card h2 a:hover{text-decoration:underline}
.score{font:600 34px/1 Poppins,sans-serif;margin:0;white-space:nowrap}.score small{font-size:14px;margin-left:6px}.up{color:var(--ok)}.down{color:var(--bad)}
.head{margin:10px 0 12px;max-width:70ch}
.counts{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:0 0 10px}
.counts li{font-size:13px;padding:4px 10px;border-radius:999px}
.s-a{background:#E3F2EA;color:var(--ok)}.s-d{background:#FBEFD9;color:var(--warn)}.s-b{background:#FBE5E8;color:var(--bad)}.s-n{background:#ECEAE9;color:#6B6A69}
.themes,.note{color:var(--ink-3);font-size:13.5px;margin:6px 0}.new{color:var(--bad);font-weight:600;margin:6px 0}
.links{display:flex;gap:16px;flex-wrap:wrap;margin:14px 0 0;align-items:center}
.links .primary{background:var(--ink);color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:600}
.how{margin-top:40px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:22px 24px}
.how h2{font:600 17px/1.3 Poppins,sans-serif;margin:0 0 10px}.how ol{margin:0;padding-left:20px}.how li{margin:6px 0}
</style></head><body>
<header><div><h1>Atom parity</h1><p>Figma compared with Storybook. Updated ${esc(when)}, and every weekday night.</p></div></header>
<main>
<div class="grid">${entries.map(card).join('')}</div>
<section class="how" aria-labelledby="how">
  <h2 id="how">Check something new</h2>
  <ol>
    <li>Copy the link to a Figma component page (right-click the page, then <b>Copy link to page</b>), and the link to the Storybook.</li>
    <li>${runUrl ? `Open <a href="${runUrl}">Run a check</a>` : 'Open the repository\'s Actions tab'} and click <b>Run workflow</b>.</li>
    <li>Paste both links, give it a name, and click the green <b>Run workflow</b> button. The report appears on this page in about 10 minutes, and the check is saved for the nightly run.</li>
  </ol>
</section>
</main></body></html>`;
}
