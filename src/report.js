// Writes the HTML report, a Jira-importable CSV and a Markdown summary for CI.
import fs from 'node:fs';
import path from 'node:path';
import { html } from './report-html.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function writeReport(results, outDir, opts = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.stringify(results).replace(/</g, '\\u003c');
  fs.writeFileSync(path.join(outDir, 'index.html'), html(results, data, opts));
  fs.writeFileSync(path.join(outDir, 'issues.csv'), csv(results, opts));
  fs.writeFileSync(path.join(outDir, 'summary.md'), markdown(results, opts));
  return path.join(outDir, 'index.html');
}

// ---------------------------------------------------------------- CSV (Jira import)
function csv(results, opts) {
  const rows = [['Summary', 'Description', 'Issue Type', 'Priority', 'Labels', 'Component/s']];
  for (const c of results.components) {
    for (const ch of c.checks) {
      if (ch.status !== 'fail' && ch.status !== 'warn') continue;
      const where = [ch.brands.length ? `Brands: ${ch.brands.join(', ')}` : '', ch.variants.length ? `Variants: ${ch.variants.slice(0, 8).join('; ')}${ch.variants.length > 8 ? ` (+${ch.variants.length - 8} more)` : ''}` : ''].filter(Boolean).join('\n');
      const links = [c.figma?.url ? `Figma: ${c.figma.url}` : '', c.code?.url ? `Storybook: ${c.code.url}` : '', opts.reportUrl ? `Report: ${opts.reportUrl}#c-${encodeURIComponent(c.key)}` : ''].filter(Boolean).join('\n');
      rows.push([
        `[Atom parity] ${c.name}: ${ch.title}`,
        [ch.detail, where, links, `Found by atom-parity on ${results.meta.generatedAt.slice(0, 10)}`].filter(Boolean).join('\n\n'),
        'Task', ch.status === 'fail' ? 'High' : 'Medium',
        ['atom-parity', `parity-${ch.category.toLowerCase()}`, `owner-${(ch.owner ?? 'both').toLowerCase()}`].join(' '),
        'Atom Design System',
      ]);
    }
  }
  return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
}

// ---------------------------------------------------------------- Markdown (CI summary / PR comment)
function markdown(r, opts) {
  const s = r.summary;
  const d = r.delta;
  const lines = [];
  lines.push(`## Atom parity: ${s.score}%${d?.previousScore != null ? ` (${s.score - d.previousScore >= 0 ? '+' : ''}${s.score - d.previousScore} since last run)` : ''}`);
  lines.push('', s.headline, '');
  lines.push('| Aligned | Drifted | Broken | Not built | Not in Figma |', '|---|---|---|---|---|');
  lines.push(`| ${s.components.aligned} | ${s.components.drifted} | ${s.components.broken} | ${s.components.missingInCode} | ${s.components.missingInDesign} |`, '');
  if (d) {
    if (d.newFails.length) {
      lines.push(`### ${d.newFails.length} new failure${d.newFails.length === 1 ? '' : 's'}`);
      d.newFails.slice(0, 15).forEach((f) => lines.push(`- **${f.component}**: ${f.title} _(${f.category})_`));
      lines.push('');
    }
    if (d.fixed.length) { lines.push(`### ${d.fixed.length} fixed`); d.fixed.slice(0, 10).forEach((f) => lines.push(`- ${f.component}: ${f.title}`)); lines.push(''); }
  }
  if (s.themes.length) {
    lines.push('### Biggest themes');
    s.themes.slice(0, 6).forEach((t) => lines.push(`- ${t.status === 'fail' ? '🔴' : '🟠'} ${t.title}: ${t.components.length} component${t.components.length === 1 ? '' : 's'} (${t.owner})`));
    lines.push('');
  }
  if (opts.reportUrl) lines.push(`[Open the full report](${opts.reportUrl})`);
  return lines.join('\n');
}

