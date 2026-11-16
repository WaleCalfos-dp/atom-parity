// Writes the HTML report, a Jira-importable CSV and a Markdown summary for CI.
import fs from 'node:fs';
import path from 'node:path';

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

// ---------------------------------------------------------------- HTML
function html(r, data, opts) {
  const title = `Atom parity report, ${r.meta.generatedAt.slice(0, 10)}`;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#components">Skip to components</a>
<header class="masthead">
  <div class="wrap masthead-in">
    <div class="brandmark" aria-hidden="true"><span></span><span></span></div>
    <div>
      <p class="product">Atom design system</p>
      <p class="sub">Figma library compared with Storybook</p>
    </div>
    <dl class="runinfo" id="runinfo"></dl>
  </div>
</header>
<main>
  <section class="hero wrap" aria-labelledby="headline">
    <div class="hero-text">
      <p class="score" id="score"></p>
      <h1 id="headline"></h1>
      <p class="delta" id="delta"></p>
    </div>
    <div class="map-col">
      <div class="map" id="map" aria-label="Every component, coloured by status"></div>
      <ul class="legend" id="legend"></ul>
    </div>
  </section>

  <section class="wrap split" aria-label="Summary">
    <div class="panel works">
      <h2>What works</h2>
      <ul id="works"></ul>
    </div>
    <div class="panel broken">
      <h2>What's broken</h2>
      <ol id="themes"></ol>
    </div>
  </section>

  <section class="wrap" aria-labelledby="who">
    <h2 id="who">Who needs to act</h2>
    <div class="owners" id="owners"></div>
    <div class="cats" id="cats"></div>
  </section>

  <section class="wrap" aria-labelledby="brands-h">
    <h2 id="brands-h">Brands</h2>
    <p class="note">Each Figma brand mode is compared with the matching Storybook <code id="brandGlobal"></code> value.</p>
    <div class="brands" id="brands"></div>
  </section>

  <section class="wrap" id="components" aria-labelledby="components-h">
    <div class="section-head">
      <h2 id="components-h">Components</h2>
      <div class="filters" role="group" aria-label="Filter components">
        <input type="search" id="q" placeholder="Find a component" aria-label="Find a component">
        <select id="fOwner" aria-label="Owner"><option value="">Any owner</option><option>Design</option><option>Dev</option><option>Both</option></select>
        <select id="fCat" aria-label="Category"><option value="">Any category</option></select>
      </div>
    </div>
    <div class="chips" id="statusChips" role="group" aria-label="Status"></div>
    <div id="complist"></div>
  </section>

  <section class="wrap" id="tokens" aria-labelledby="tokens-h">
    <div class="section-head">
      <h2 id="tokens-h">Tokens</h2>
      <div class="filters"><select id="fTok" aria-label="Token status"><option value="issues">Differences and renames</option><option value="">All tokens</option></select></div>
    </div>
    <p class="note" id="tokNote"></p>
    <div class="tablewrap"><table class="tok" id="tokTable"></table></div>
  </section>

  <section class="wrap how" aria-labelledby="how-h">
    <h2 id="how-h">How to read this</h2>
    <dl>
      <dt>Aligned</dt><dd>Name, properties, tokens, looks, accessibility and behaviour all match the Figma library.</dd>
      <dt>Drifted</dt><dd>Works for users, but names, properties or tokens differ from Figma. These differences get more expensive to fix over time.</dd>
      <dt>Broken</dt><dd>Something people would notice: it looks different, fails an accessibility check, has no focus indicator, or doesn't render.</dd>
      <dt>Not built</dt><dd>In the Figma library with no Storybook component of the same name.</dd>
      <dt>Not in Figma</dt><dd>In Storybook with no Figma component of the same name.</dd>
      <dt>Parity score</dt><dd>The share of checks passed across all Figma components (a warning counts as half). Components that aren't built score zero.</dd>
    </dl>
    <p class="note">Generated by atom-parity. Automated accessibility checks catch around a third of WCAG issues, so keep manual reviews for screen readers and complex flows.</p>
  </section>
</main>
<script type="application/json" id="data">${data}</script>
<script>${JS}</script>
</body>
</html>`;
}

const CSS = `
:root{
  --ink:#0A2333; --ink-2:#3B4A55; --ink-3:#6B7780; --line:#E3E0DE; --line-2:#ECEAE9; --page:#FAF8F7; --card:#FFFFFF;
  --blue:#006B99; --ok:#1B7A4E; --ok-bg:#E3F2EA; --warn:#A35F00; --warn-bg:#FBEFD9; --bad:#C2082A; --bad-bg:#FBE5E8; --none:#7A7978; --none-bg:#ECEAE9; --info:#2E5E8C; --info-bg:#E4EEF7;
  --display:"Poppins",ui-sans-serif,system-ui,sans-serif; --text:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --r:10px;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.55 var(--text);font-feature-settings:"tnum" 1}
.wrap{max-width:1180px;margin-inline:auto;padding-inline:28px}
.skip{position:absolute;left:-999px}.skip:focus{left:12px;top:12px;background:var(--card);padding:8px 12px;border-radius:6px;z-index:9}
a{color:var(--blue)}
:focus-visible{outline:2px solid var(--blue);outline-offset:2px;border-radius:4px}
h1,h2,h3{font-family:var(--display);font-weight:600;letter-spacing:-.01em;margin:0}
h2{font-size:22px;margin:0 0 14px}
h3{font-size:16px}
code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--line-2);padding:1px 5px;border-radius:4px}
.note{color:var(--ink-3);margin:-6px 0 14px;max-width:72ch}
main>section{margin-block:64px}

.masthead{background:var(--ink);color:#fff}
.masthead-in{display:flex;align-items:center;gap:16px;padding-top:18px;padding-bottom:18px;flex-wrap:wrap}
.brandmark{display:flex;gap:3px}.brandmark span{width:14px;height:22px;border-radius:7px;background:#fff}.brandmark span+span{background:#6FB7D6}
.product{font-family:var(--display);font-weight:600;font-size:16px;margin:0}
.sub{margin:0;color:#B9C4CC;font-size:13px}
.runinfo{margin:0 0 0 auto;display:grid;grid-template-columns:auto auto;gap:2px 14px;font-size:12.5px;color:#B9C4CC}
.runinfo dt{color:#8EA0AD}.runinfo dd{margin:0;color:#fff}
.runinfo a{color:#fff}

.hero{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:40px;align-items:start;margin-top:44px}
.score{font-family:var(--display);font-weight:600;font-size:76px;line-height:1;margin:0 0 14px;letter-spacing:-.03em}
.score small{font-size:20px;font-weight:500;color:var(--ink-3);margin-left:8px;letter-spacing:0}
#headline{font-size:24px;line-height:1.35;font-weight:500;max-width:30ch}
.delta{margin:14px 0 0;color:var(--ink-2)}
.delta b.up{color:var(--ok)}.delta b.down{color:var(--bad)}
.map-col{display:flex;flex-direction:column;gap:14px}
.map{display:flex;flex-direction:column;gap:12px}
.map-group{display:grid;grid-template-columns:132px 1fr;gap:10px;align-items:start}
.map-group h3{font:500 12.5px/1.3 var(--text);color:var(--ink-3);padding-top:5px}
.tiles{display:flex;flex-wrap:wrap;gap:5px}
.tile{all:unset;cursor:pointer;font-size:12px;line-height:1;padding:7px 9px;border-radius:6px;border:1px solid transparent;white-space:nowrap}
.tile:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.tile:hover{border-color:currentColor}
.s-Aligned{background:var(--ok-bg);color:var(--ok)}
.s-Drifted{background:var(--warn-bg);color:var(--warn)}
.s-Broken{background:var(--bad-bg);color:var(--bad)}
.s-Missing-in-code{background:var(--none-bg);color:var(--none);border-style:dashed;border-color:#C9C7C5}
.s-Missing-in-design{background:var(--info-bg);color:var(--info)}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;padding:14px 0 0 142px;margin:0;border-top:1px solid var(--line);list-style:none;font-size:12.5px;color:var(--ink-3)}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}

.split{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:22px 24px}
.panel h2{font-size:18px}
.works ul{margin:0;padding:0;list-style:none}
.works li{padding:8px 0 8px 26px;position:relative;border-top:1px solid var(--line-2)}
.works li:first-child{border-top:0}
.works li::before{content:"";position:absolute;left:2px;top:14px;width:12px;height:7px;border-left:2px solid var(--ok);border-bottom:2px solid var(--ok);transform:rotate(-45deg)}
.broken ol{margin:0;padding:0;list-style:none;counter-reset:t}
.broken li{display:grid;grid-template-columns:1fr auto;gap:4px 12px;padding:9px 0;border-top:1px solid var(--line-2)}
.broken li:first-child{border-top:0}
.broken .t{font-weight:500}
.broken .who{font-size:12.5px;color:var(--ink-3)}
.broken .n{font-family:var(--display);font-weight:600;font-size:18px;text-align:right}
.broken .n small{display:block;font:12px var(--text);color:var(--ink-3)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;vertical-align:1px}
.dot.fail{background:var(--bad)}.dot.warn{background:var(--warn)}.dot.pass{background:var(--ok)}.dot.info{background:var(--info)}

.owners{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:24px}
.owner{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:18px 20px}
.owner b{font-family:var(--display);font-size:30px;font-weight:600;display:block;line-height:1.1}
.owner span{color:var(--ink-3);font-size:13px}
.cats{display:grid;gap:8px}
.cat{display:grid;grid-template-columns:140px 1fr 150px;gap:14px;align-items:center;font-size:13.5px}
.bar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--line-2)}
.bar i{display:block;height:100%}
.bar .p{background:#7BC4A0}.bar .w{background:#E7A43C}.bar .f{background:var(--bad)}
.cat .nums{color:var(--ink-3);font-size:12.5px;text-align:right}

.brands{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.brand{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px}
.brand p{margin:2px 0 0;color:var(--ink-3);font-size:13px}
.brand.missing{border-style:dashed}

.section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:12px}
.section-head h2{margin:0}
.filters{display:flex;gap:8px;flex-wrap:wrap}
input[type=search],select{height:36px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font:inherit;font-size:14px;padding:0 10px}
input[type=search]{width:220px}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
.chip{all:unset;cursor:pointer;font-size:13px;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--card)}
.chip[aria-pressed=true]{background:var(--ink);color:#fff;border-color:var(--ink)}
.chip:focus-visible{outline:2px solid var(--blue);outline-offset:2px}

.comp{background:var(--card);border:1px solid var(--line);border-radius:var(--r);margin-bottom:8px;scroll-margin-top:16px}
.comp>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:minmax(160px,1.4fr) 116px minmax(120px,1fr) minmax(160px,1.6fr) 70px;gap:14px;align-items:center;padding:14px 18px}
.comp>summary::-webkit-details-marker{display:none}
.comp[open]>summary{border-bottom:1px solid var(--line-2)}
.comp .nm{font-weight:600;font-family:var(--display);font-size:15px}
.comp .nm small{display:block;font:12.5px var(--text);color:var(--ink-3);font-weight:400}
.pill{display:inline-block;font-size:12px;padding:4px 9px;border-radius:999px;white-space:nowrap}
.mini{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-3)}
.mini .bar{flex:1;height:8px}
.counts{font-size:12.5px;color:var(--ink-2)}
.counts b{font-weight:600}
.counts .f{color:var(--bad)}.counts .w{color:var(--warn)}
.open-hint{justify-self:end;font-size:12.5px;color:var(--blue)}
.comp-body{padding:6px 18px 20px}
.links{display:flex;gap:16px;flex-wrap:wrap;font-size:13.5px;margin:10px 0 4px}
.cgroup{margin-top:18px}
.cgroup h3{font-size:14px;margin-bottom:6px;color:var(--ink-2)}
.check{display:grid;grid-template-columns:18px 1fr auto;gap:2px 8px;padding:8px 0;border-top:1px solid var(--line-2);font-size:14px}
.check .d{grid-column:2/4;color:var(--ink-3);font-size:13px;overflow-wrap:anywhere}
.check .where{grid-column:2/4;font-size:12.5px;color:var(--ink-2)}
.check .tag{font-size:12px;color:var(--ink-3);white-space:nowrap}
.check .dot{margin:6px 0 0}
.passes{font-size:13px;color:var(--ink-3);margin:6px 0 0}
.props{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
.props th,.props td{text-align:left;padding:7px 8px;border-top:1px solid var(--line-2);vertical-align:top}
.props th{font-weight:500;color:var(--ink-3);border-top:0}
.v-exact,.v-convention{color:var(--ok)}.v-missing{color:var(--bad)}.v-config,.v-inferred,.v-similar{color:var(--warn)}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:8px}
.shot{border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--page)}
.shot header{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;margin-bottom:8px}
.shot header b{font-weight:500}
.trio{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.trio figure{margin:0;background:#fff;border:1px solid var(--line-2);border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:4px;min-height:64px}
.trio figcaption{font-size:11.5px;color:var(--ink-3)}
.trio img{max-width:100%;height:auto;align-self:center;image-rendering:auto}
.empty{color:var(--ink-3);font-size:13px}
.tablewrap{overflow:auto;border:1px solid var(--line);border-radius:var(--r);background:var(--card);max-height:640px}
table.tok{border-collapse:collapse;width:100%;font-size:13px}
table.tok th,table.tok td{padding:8px 12px;border-bottom:1px solid var(--line-2);text-align:left;white-space:nowrap}
table.tok thead th{position:sticky;top:0;background:var(--card);font-weight:500;color:var(--ink-3);z-index:1}
.sw{display:inline-block;width:12px;height:12px;border-radius:3px;border:1px solid rgba(0,0,0,.15);vertical-align:-2px;margin-right:6px}
td.differs{color:var(--bad)}td.missing{color:var(--none);font-style:italic}
.how dl{display:grid;grid-template-columns:140px 1fr;gap:8px 20px;max-width:860px}
.how dt{font-weight:600}.how dd{margin:0;color:var(--ink-2)}
@media (max-width:900px){
  .hero,.split{grid-template-columns:1fr}.legend{padding-left:0}
  .owners{grid-template-columns:1fr}
  .comp>summary{grid-template-columns:1fr auto}.comp>summary>.mini,.comp>summary>.counts,.comp>summary>.open-hint{display:none}
  .cat{grid-template-columns:110px 1fr}.cat .nums{display:none}
  .map-group{grid-template-columns:1fr}
  .runinfo{margin-left:0}
}
@media (prefers-reduced-motion:no-preference){.tile{transition:transform .12s}.tile:hover{transform:translateY(-1px)}}
@media print{.filters,.chips,.skip{display:none}.comp{break-inside:avoid}body{background:#fff}}
`;

const JS = `
const R = JSON.parse(document.getElementById('data').textContent);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const STATUS = ['Aligned','Drifted','Broken','Missing in code','Missing in design'];
const LABEL = {'Aligned':'Aligned','Drifted':'Drifted','Broken':'Broken','Missing in code':'Not built','Missing in design':'Not in Figma'};
const cls = (s) => 's-' + s.replace(/ /g,'-');
const S = R.summary;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

// masthead
$('runinfo').innerHTML = [
  ['Run', fmtDate(R.meta.generatedAt)],
  ['Figma snapshot', fmtDate(R.meta.figma.exportedAt) + (R.meta.figma.exportedBy ? ' by ' + esc(R.meta.figma.exportedBy) : '')],
  ['Storybook', '<a href="' + esc(R.meta.storybook.url) + '">' + esc(new URL(R.meta.storybook.base).host) + '</a>'],
].concat(R.meta.figmaScope && R.meta.figmaScope !== 'file' ? [['Scope', 'Partial Figma snapshot (' + esc(R.meta.figmaScope) + ')']] : []).map(([k,v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('');

// hero
$('score').innerHTML = S.score + '%<small>parity</small>';
$('headline').textContent = S.headline;
if (R.delta) {
  const diff = R.delta.previousScore != null ? S.score - R.delta.previousScore : null;
  $('delta').innerHTML = (diff != null ? '<b class="' + (diff >= 0 ? 'up' : 'down') + '">' + (diff >= 0 ? '+' : '') + diff + ' points</b> since ' + fmtDate(R.delta.since) + '. ' : '') +
    R.delta.newFails.length + ' new failure' + (R.delta.newFails.length === 1 ? '' : 's') + ', ' + R.delta.fixed.length + ' fixed.';
} else $('delta').textContent = 'First run. Future runs will show what changed.';

// library map grouped by Figma section (code-only components last)
const groups = new Map();
R.components.forEach((c) => {
  const g = c.figma ? (c.figma.section || 'Other') : 'Only in Storybook';
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(c);
});
const order = [...groups.keys()].sort((a,b) => (a === 'Only in Storybook') - (b === 'Only in Storybook'));
const title = (s) => s.toLowerCase().replace(/(^|\\s)\\S/g, (m) => m.toUpperCase());
$('map').innerHTML = order.map((g) => '<div class="map-group"><h3>' + esc(title(g)) + '</h3><div class="tiles">' +
  groups.get(g).map((c) => '<button class="tile ' + cls(c.status) + '" data-key="' + esc(c.key) + '" title="' + esc(c.name + ': ' + LABEL[c.status] + (c.score != null ? ', ' + c.score + '%' : '')) + '">' + esc(c.name) + '</button>').join('') + '</div></div>').join('');
$('map').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) openComponent(t.dataset.key); });
$('legend').innerHTML = STATUS.map((s) => '<li><i class="' + cls(s) + '"></i>' + LABEL[s] + ' ' + R.components.filter((c) => c.status === s).length + '</li>').join('');

// works / broken
$('works').innerHTML = S.works.length ? S.works.map((w) => '<li>' + esc(w) + '</li>').join('') : '<li>Nothing fully aligned yet.</li>';
$('themes').innerHTML = S.themes.length ? S.themes.map((t) => '<li><div><div class="t"><span class="dot ' + t.status + '"></span>' + esc(t.title) + '</div><div class="who">' + esc(t.category) + ', owned by ' + esc(t.owner === 'Both' ? 'design and dev' : t.owner === 'Dev' ? 'dev' : 'design') + '. ' + esc(t.components.slice(0,5).join(', ')) + (t.components.length > 5 ? '…' : '') + '</div></div><div class="n">' + t.components.length + '<small>component' + (t.components.length === 1 ? '' : 's') + '</small></div></li>').join('') : '<li>No issues found.</li>';

// owners + categories
const ownerText = { Design: 'Design to fix', Dev: 'Dev to fix', Both: 'Design and dev to agree' };
$('owners').innerHTML = ['Design','Dev','Both'].map((o) => '<div class="owner"><b>' + (S.byOwner[o].fail + S.byOwner[o].warn) + '</b><span>' + ownerText[o] + ': ' + S.byOwner[o].fail + ' failing, ' + S.byOwner[o].warn + ' warnings</span></div>').join('');
$('cats').innerHTML = Object.entries(S.byCategory).filter(([,v]) => v.pass + v.warn + v.fail).map(([k,v]) => {
  const t = v.pass + v.warn + v.fail;
  return '<div class="cat"><span>' + k + '</span><div class="bar" role="img" aria-label="' + k + ': ' + v.pass + ' pass, ' + v.warn + ' warn, ' + v.fail + ' fail"><i class="p" style="width:' + (100*v.pass/t) + '%"></i><i class="w" style="width:' + (100*v.warn/t) + '%"></i><i class="f" style="width:' + (100*v.fail/t) + '%"></i></div><span class="nums">' + v.pass + ' pass, ' + v.warn + ' warn, ' + v.fail + ' fail</span></div>';
}).join('');
const fCat = $('fCat'); Object.keys(S.byCategory).forEach((k) => { const o = document.createElement('option'); o.textContent = k; fCat.appendChild(o); });

// brands
$('brandGlobal').textContent = R.meta.storybook.brandGlobal || 'brand';
$('brands').innerHTML = R.brands.pairs.map((p) => '<div class="brand' + (p.code ? '' : ' missing') + '"><b>' + esc(p.figma) + '</b><p>' + (p.code ? 'Storybook: ' + esc(p.code) + (p.how === 'config' ? ' (mapped in config)' : '') : 'No matching Storybook brand, so it isn\\'t checked') + '</p></div>').join('') +
  R.brands.onlyInCode.map((b) => '<div class="brand missing"><b>' + esc(b) + '</b><p>Only in Storybook: no Figma brand mode</p></div>').join('');

// components
const state = { status: '', q: '', owner: '', cat: '' };
$('statusChips').innerHTML = ['', ...STATUS].map((s) => '<button class="chip" aria-pressed="' + (s === '' ? 'true' : 'false') + '" data-s="' + s + '">' + (s ? LABEL[s] : 'All') + ' ' + (s ? R.components.filter((c) => c.status === s).length : R.components.length) + '</button>').join('');
$('statusChips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; state.status = b.dataset.s; document.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', x === b)); renderList(); });
$('q').addEventListener('input', (e) => { state.q = e.target.value.toLowerCase(); renderList(); });
$('fOwner').addEventListener('change', (e) => { state.owner = e.target.value; renderList(); });
$('fCat').addEventListener('change', (e) => { state.cat = e.target.value; renderList(); });

const statusRank = { 'Broken': 0, 'Drifted': 1, 'Missing in code': 2, 'Missing in design': 3, 'Aligned': 4 };
function renderList() {
  const list = R.components.filter((c) => (!state.status || c.status === state.status)
    && (!state.q || (c.name + ' ' + (c.code?.title || '')).toLowerCase().includes(state.q))
    && (!state.owner || c.checks.some((ch) => ch.owner === state.owner && ch.status !== 'pass'))
    && (!state.cat || c.checks.some((ch) => ch.category === state.cat && ch.status !== 'pass')))
    .sort((a,b) => statusRank[a.status] - statusRank[b.status] || (a.score ?? 101) - (b.score ?? 101) || a.name.localeCompare(b.name));
  $('complist').innerHTML = list.length ? list.map(row).join('') : '<p class="empty">No components match these filters.</p>';
}
function row(c) {
  const f = c.checks.filter((x) => x.status === 'fail').length, w = c.checks.filter((x) => x.status === 'warn').length;
  const sub = c.figma && c.code ? (c.code.title) : c.code ? c.code.title : (c.figma.page || 'Figma');
  return '<details class="comp" id="c-' + esc(c.key) + '" data-key="' + esc(c.key) + '"><summary>' +
    '<span class="nm">' + esc(c.name) + '<small>' + esc(sub) + '</small></span>' +
    '<span><span class="pill ' + cls(c.status) + '">' + LABEL[c.status] + '</span></span>' +
    '<span class="mini">' + (c.score != null ? '<span class="bar"><i class="p" style="width:' + c.score + '%"></i></span>' + c.score + '%' : '') + '</span>' +
    '<span class="counts">' + (f ? '<b class="f">' + f + '</b> failing' : '') + (f && w ? ', ' : '') + (w ? '<b class="w">' + w + '</b> warning' + (w === 1 ? '' : 's') : '') + (!f && !w ? 'All checks pass' : '') + '</span>' +
    '<span class="open-hint">Details</span></summary><div class="comp-body"></div></details>';
}
document.addEventListener('toggle', (e) => {
  const d = e.target; if (!d.classList || !d.classList.contains('comp') || !d.open) return;
  const body = d.querySelector('.comp-body'); if (body.dataset.done) return;
  body.innerHTML = detail(R.components.find((c) => c.key === d.dataset.key)); body.dataset.done = '1';
}, true);

function where(ch) {
  const parts = [];
  if (ch.brands.length) parts.push('Brands: ' + ch.brands.join(', '));
  if (ch.variants.length) parts.push((ch.variants.length > 4 ? ch.variants.length + ' variants, including ' : 'Variants: ') + ch.variants.slice(0, 4).join('; '));
  const n = ch.counts; const total = n.pass + n.warn + n.fail;
  if (total > 1 && ch.status !== 'pass') parts.push((n.fail + n.warn) + ' of ' + total + ' renders');
  return parts.length ? '<div class="where">' + esc(parts.join('. ')) + '</div>' : '';
}
function detail(c) {
  let h = '<div class="links">' + (c.figma?.url ? '<a href="' + esc(c.figma.url) + '" target="_blank" rel="noopener">Open in Figma</a>' : '') + (c.code?.url ? '<a href="' + esc(c.code.url) + '" target="_blank" rel="noopener">Open in Storybook</a>' : '') +
    (c.figma ? '<span class="empty">' + c.figma.variants + ' Figma variants' + (c.rendered != null ? ', ' + c.rendered + ' compared' : '') + '</span>' : '') + '</div>';
  if (c.suggestions?.length) h += '<p class="empty">Possible matches: ' + esc(c.suggestions.map((s) => s.title || s.name).join(', ')) + '</p>';
  const cats = [...new Set(c.checks.map((x) => x.category))];
  for (const cat of cats) {
    const items = c.checks.filter((x) => x.category === cat);
    const bad = items.filter((x) => x.status !== 'pass').sort((a,b) => (b.status === 'fail') - (a.status === 'fail'));
    const good = items.filter((x) => x.status === 'pass');
    h += '<div class="cgroup"><h3>' + esc(cat) + '</h3>';
    h += bad.map((x) => '<div class="check"><span class="dot ' + x.status + '"></span><span>' + esc(x.title) + '</span><span class="tag">' + esc(x.owner === 'Both' ? 'Design + dev' : x.owner) + '</span>' + (x.detail ? '<div class="d">' + esc(x.detail) + '</div>' : '') + where(x) + '</div>').join('');
    if (good.length) h += '<p class="passes"><span class="dot pass"></span>' + good.length + ' passing: ' + esc(good.map((x) => x.label).slice(0, 8).join(', ')) + (good.length > 8 ? '…' : '') + '</p>';
    h += '</div>';
  }
  if (c.props?.props?.length) {
    h += '<div class="cgroup"><h3>Property mapping</h3><table class="props"><thead><tr><th>Figma</th><th>Storybook</th><th>Values</th></tr></thead><tbody>' +
      c.props.props.map((p) => '<tr><td>' + esc(p.figma) + '</td><td class="v-' + (p.how === 'state' ? 'exact' : p.how) + '">' + esc(p.how === 'state' ? 'states' : p.codeArg || 'missing') + '</td><td>' +
        p.values.map((v) => '<span class="v-' + (v.how === 'interaction' || v.how === 'boolean' || v.how === 'enum' || v.how === 'free' ? 'exact' : v.how) + '">' + esc(v.figma) + (v.code !== undefined && v.code !== null && String(v.code).toLowerCase() !== String(v.figma).toLowerCase() ? ' → ' + esc(v.code) : v.boolArg ? ' → ' + esc(v.boolArg) : v.interaction ? ' → :' + esc(v.interaction) : '') + '</span>').join(', ') +
        (p.codeOnlyValues?.length ? ' <span class="empty">(code only: ' + esc(p.codeOnlyValues.join(', ')) + ')</span>' : '') + '</td></tr>').join('') +
      (c.props.codeOnly.length ? '<tr><td class="empty">none</td><td class="v-config">' + esc(c.props.codeOnly.map((a) => a.name).join(', ')) + '</td><td class="empty">Code-only props</td></tr>' : '') +
      '</tbody></table></div>';
  }
  if (c.gallery?.length) {
    h += '<div class="cgroup"><h3>Side by side</h3><p class="empty">Most different first. Red marks pixels that differ.</p><div class="gallery">' + c.gallery.map((g) =>
      '<div class="shot"><header><b>' + esc(g.variant) + '</b><span>' + esc(g.brand || '') + (g.mismatch != null ? ', ' + (g.mismatch * 100).toFixed(1) + '% different' : '') + '</span></header><div class="trio">' +
      fig('Figma', g.figma) + fig('Storybook', g.code) + fig('Difference', g.diff) + '</div>' +
      (g.sizeDelta && (Math.abs(g.sizeDelta.h) > 0.5 || Math.abs(g.sizeDelta.w) > 0.5) ? '<p class="empty">Figma ' + g.figmaSize.w + ' × ' + g.figmaSize.h + 'px, code ' + g.codeSize.w + ' × ' + g.codeSize.h + 'px</p>' : '') + '</div>').join('') + '</div></div>';
  }
  return h;
}
const fig = (cap, src) => '<figure><figcaption>' + cap + '</figcaption>' + (src ? '<img loading="lazy" alt="' + cap + ' render" src="' + esc(src) + '">' : '<span class="empty">None</span>') + '</figure>';
function openComponent(key) {
  state.status = ''; state.q = ''; $('q').value = ''; document.querySelectorAll('.chip').forEach((x, i) => x.setAttribute('aria-pressed', i === 0)); renderList();
  const el = document.getElementById('c-' + key); if (!el) return; el.open = true; el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); el.querySelector('summary').focus();
}
renderList();
if (location.hash.startsWith('#c-')) openComponent(decodeURIComponent(location.hash.slice(3)));

// tokens
const T = R.tokens; const brandNames = R.brands.pairs.filter((p) => p.code).map((p) => p.figma);
const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
$('tokNote').textContent = pl(T.summary.total, 'token is', 'tokens are') + ' used by the compared components. ' + pl(T.summary.match, 'matches', 'match') + ' in every brand, ' + pl(T.summary.differs, 'has a different value', 'have different values') + ' and ' + pl(T.summary.missing, 'is', 'are') + ' missing from code' + (T.summary.renamed ? ', and ' + pl(T.summary.renamed, 'is', 'are') + ' named differently in code' : '') + '. Code defines ' + pl(T.summary.definedInCode, 'token', 'tokens') + ' in total.';
const isHex = (v) => /^#|^rgb/i.test(String(v || ''));
function renderTokens() {
  const only = $('fTok').value === 'issues';
  const rows = T.rows.filter((r) => !only || r.status !== 'match' || r.conventional || r.retired);
  $('tokTable').innerHTML = '<thead><tr><th>Figma variable</th><th>CSS variable</th>' + brandNames.map((b) => '<th>' + esc(b) + '</th>').join('') + '</tr></thead><tbody>' +
    (rows.length ? rows.map((r) => '<tr><td>' + esc(r.figma) + (r.retired ? ' <span class="pill s-Drifted">retired: ' + esc(r.retired) + '</span>' : '') + '</td><td><code>' + esc(r.css) + '</code></td>' +
      brandNames.map((b) => { const v = r.brands[b]; if (!v) return '<td></td>'; return '<td class="' + v.status + '">' + (v.status === 'missing' ? 'Not in code' : (isHex(v.design) ? '<span class="sw" style="background:' + esc(v.design) + '"></span>' : '') + esc(v.design) + (v.status === 'differs' ? ' / code ' + (isHex(v.code) ? '<span class="sw" style="background:' + esc(v.code) + '"></span>' : '') + esc(v.code) : '')) + '</td>'; }).join('') + '</tr>').join('')
      : '<tr><td colspan="' + (2 + brandNames.length) + '" class="empty">Every token matches.</td></tr>') + '</tbody>';
}
$('fTok').addEventListener('change', renderTokens); renderTokens();
`;
