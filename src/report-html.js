// The report page for one check: readable top to bottom.
import { MARK } from './app.js';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function html(r, data, opts = {}) {
  const title = opts.title || [r.components.find((c) => c.figma)?.figma?.page, r.meta.figma.file?.name].filter(Boolean)[0] || 'Atom parity';
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Atom parity</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<header class="topbar"><div class="in">
  <a class="home" href="../" aria-label="Atom parity: all checks">${MARK}<span class="brand"><b>Atom parity</b><span>All checks</span></span></a>
  <span class="spacer"></span><span class="when" id="when"></span>
</div></header>
<div class="wrap">
  <header class="head">
    <p class="crumb"><a href="../">Checks</a> / ${esc(title)}</p>
    <div class="sum">
      <div><h1>${esc(title)}</h1><p class="headline" id="headline"></p><p class="delta" id="delta"></p></div>
      <div class="scorebox"><p class="score" id="score"></p><span>parity</span></div>
    </div>
    <div class="meter" id="meter"></div>
    <ul class="legend" id="legend"></ul>
  </header>

  <section id="attention" aria-labelledby="att-h"><h2 id="att-h">Needs attention</h2><ul class="att" id="themes"></ul></section>

  <section aria-labelledby="comp-h">
    <div class="bar"><h2 id="comp-h">Components</h2><input type="search" id="q" placeholder="Find a component" aria-label="Find a component"></div>
    <div class="chips" id="chips" role="group" aria-label="Filter by status"></div>
    <div id="list"></div>
  </section>

  <details class="more" id="tokens"><summary>Tokens</summary><p class="note" id="tokNote"></p><label class="note" id="tokAllLabel"><input type="checkbox" id="tokAll"> Show matching tokens too</label><div class="tw"><table class="tok" id="tokTable"></table></div></details>
  <details class="more"><summary>Brands</summary><ul class="plain" id="brands"></ul></details>
  <details class="more"><summary>How to read this</summary>
    <dl class="how">
      <dt>Aligned</dt><dd>Matches Figma: names, properties, tokens, looks, accessibility and behaviour.</dd>
      <dt>Drifted</dt><dd>Works for people, but names, properties or tokens differ from Figma.</dd>
      <dt>Broken</dt><dd>Something people would notice: it looks different, fails an accessibility check, has no focus indicator or doesn't render.</dd>
      <dt>Not built</dt><dd>In Figma, with no Storybook component of the same name.</dd>
      <dt>Score</dt><dd>Share of checks passed across the Figma components. A warning counts as half; not built counts as zero.</dd>
    </dl>
    <p class="note">Automated accessibility checks catch about a third of WCAG issues. Keep manual screen-reader reviews.</p>
  </details>
  <footer class="foot" id="foot"></footer>
</div>
<script type="application/json" id="data">${data}</script>
<script>${JS}</script>
</body>
</html>`;
}

const CSS = `
:root{--ink:#0A2333;--ink-2:#3B4A55;--ink-3:#6B7780;--line:#E6E3E1;--soft:#F4F2F1;--page:#FAF8F7;--blue:#006B99;--ok:#1B7A4E;--warn:#A35F00;--bad:#C2082A;--none:#8A8988}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:880px;margin:0 auto;padding:28px 24px 80px}
a{color:var(--blue)}
:focus-visible{outline:2px solid var(--blue);outline-offset:2px;border-radius:6px}
.topbar{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
.topbar .in{max-width:920px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;gap:14px}
.home{display:flex;align-items:center;gap:12px;color:var(--ink);text-decoration:none}
.mark{width:34px;height:24px;flex:none}
.brand{display:flex;flex-direction:column;line-height:1.2}.brand b{font:600 15px Poppins,sans-serif}.brand span{font-size:12.5px;color:var(--ink-3)}
.home:hover .brand span{text-decoration:underline}
.spacer{flex:1}.when{font-size:13px;color:var(--ink-3)}
.wrap{max-width:920px}
.head{margin:26px 0 8px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px 26px;box-shadow:0 1px 2px rgba(10,35,51,.04),0 4px 16px rgba(10,35,51,.04)}
.crumb{margin:0 0 10px;font-size:13px;color:var(--ink-3)}.crumb a{color:var(--ink-3)}
h1{font:600 26px/1.2 Poppins,sans-serif;margin:0 0 8px;letter-spacing:-.01em}
.sum{display:flex;gap:24px;align-items:flex-start;justify-content:space-between}
.scorebox{text-align:right;flex:none}.scorebox span{font-size:12.5px;color:var(--ink-3)}
.score{font:600 44px/1 Poppins,sans-serif;margin:0;letter-spacing:-.02em}
.headline{margin:0;font-size:15.5px;color:var(--ink-2);max-width:56ch}
.meter{display:flex;height:10px;border-radius:5px;overflow:hidden;background:#EFEDEB;gap:2px;margin-top:20px}
.meter i{display:block;height:100%;min-width:4px}
.s-aligned{background:var(--ok)}.s-drifted{background:#E39A2D}.s-broken{background:var(--bad)}.s-notbuilt{background:repeating-linear-gradient(135deg,#C9C6C2 0 4px,#DEDBD8 4px 8px)}.s-notfigma{background:#4E7397}
.legend{display:flex;flex-wrap:wrap;gap:6px 20px;list-style:none;margin:12px 0 0;padding:0;font-size:13px;color:var(--ink-2)}
.legend li{display:flex;align-items:center;gap:7px}.legend i{width:9px;height:9px;border-radius:3px}.legend b{font:600 13px Poppins,sans-serif}
.thumb{width:64px;height:44px;border-radius:8px;background:var(--page);border:1px solid var(--line);display:grid;place-items:center;overflow:hidden;flex:none}
.thumb img{max-width:56px;max-height:36px;object-fit:contain}
.thumb.none{border-style:dashed}
.delta{margin:12px 0 0;font-size:13.5px;color:var(--ink-3)}
.delta b.up{color:var(--ok)}.delta b.down{color:var(--bad)}
h2{font:600 15px/1.3 Poppins,sans-serif;margin:0}
section{margin-top:40px}
.att{list-style:none;margin:12px 0 0;padding:0;background:#fff;border:1px solid var(--line);border-radius:14px}
.att li{display:flex;gap:12px;align-items:baseline;padding:12px 16px;border-top:1px solid var(--line)}
.att li:first-child{border-top:0}
.att .t{flex:1}.att .who{color:var(--ink-3);font-size:13px;white-space:nowrap}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:none;transform:translateY(-1px);background:var(--none)}
.dot.fail{background:var(--bad)}.dot.warn{background:#E7A43C}.dot.pass{background:var(--ok)}
.bar{display:flex;justify-content:space-between;align-items:center;gap:12px}
input[type=search]{height:36px;width:220px;border:1px solid var(--line);border-radius:10px;padding:0 12px;font:inherit;font-size:14px;background:#fff}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0}
.chip{all:unset;cursor:pointer;font-size:13px;padding:6px 12px;border-radius:999px;color:var(--ink-2)}
.chip:hover{background:var(--soft)}
.chip[aria-pressed=true]{background:var(--ink);color:#fff}
.chip:focus-visible{outline:2px solid var(--blue)}
#list{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.comp{border-top:1px solid var(--line);scroll-margin-top:16px}
.comp:first-child{border-top:0}
.comp>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:16px;align-items:center;padding:12px 18px}
.comp>summary::-webkit-details-marker{display:none}
.comp>summary:hover{background:#FCFBFA}
.nm{font-weight:600;min-width:0}
.nm small{display:block;font-weight:400;font-size:13px;color:var(--ink-3)}
.st{font-size:13px;display:flex;align-items:center;gap:7px;white-space:nowrap;color:var(--none)}
.st.Aligned{color:var(--ok)}.st.Drifted{color:var(--warn)}.st.Broken{color:var(--bad)}
.sc{font:600 14px Poppins,sans-serif;min-width:42px;text-align:right;color:var(--ink-2)}
.body{padding:4px 18px 22px;border-top:1px solid var(--line);background:#FCFBFA}
.links{display:flex;gap:16px;font-size:13.5px;margin:14px 0 4px;flex-wrap:wrap}
.grp{margin-top:18px}
.grp h3{font:600 13px/1.3 ui-sans-serif,system-ui,sans-serif;color:var(--ink-3);margin:0 0 4px}
.ck{display:grid;grid-template-columns:14px 1fr auto;gap:2px 10px;padding:8px 0;border-top:1px solid var(--line);font-size:14px}
.grp h3+.ck{border-top:0}
.ck .dot{margin-top:7px}
.ck .who{font-size:12.5px;color:var(--ink-3);white-space:nowrap}
.ck .d{grid-column:2/4;color:var(--ink-3);font-size:13px;overflow-wrap:anywhere}
.passes{font-size:13px;color:var(--ink-3);margin:6px 0 0}
table.map{width:100%;border-collapse:collapse;font-size:13px}
table.map th,table.map td{text-align:left;padding:6px 8px 6px 0;border-top:1px solid var(--line);vertical-align:top}
table.map th{color:var(--ink-3);font-weight:500;border-top:0}
.v-exact,.v-convention{color:var(--ok)}.v-missing{color:var(--bad)}.v-config,.v-inferred,.v-similar{color:var(--warn)}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-top:8px}
.shot{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px}
.shot p{margin:0 0 8px;font-size:12.5px;color:var(--ink-2);display:flex;justify-content:space-between;gap:8px}
.trio{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.trio figure{margin:0;display:flex;flex-direction:column;gap:4px;align-items:center}
.trio figcaption{font-size:11px;color:var(--ink-3);align-self:flex-start}
.trio img{max-width:100%;height:auto;border-radius:4px;background:var(--page)}
.more{margin-top:14px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:0 18px}
#tokens{margin-top:40px}
.more>summary{cursor:pointer;padding:14px 0;font:600 15px Poppins,sans-serif}
.more[open]{padding-bottom:16px}
.note{color:var(--ink-3);font-size:13px;margin:0 0 10px;display:block}
.tw{overflow:auto;max-height:520px;border-top:1px solid var(--line)}
table.tok{border-collapse:collapse;width:100%;font-size:13px}
table.tok th,table.tok td{padding:7px 12px 7px 0;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
table.tok th{position:sticky;top:0;background:#fff;color:var(--ink-3);font-weight:500}
code{font:12.5px ui-monospace,Menlo,monospace}
.sw{display:inline-block;width:11px;height:11px;border-radius:3px;border:1px solid rgba(0,0,0,.15);vertical-align:-1px;margin-right:5px}
td.differs{color:var(--bad)}td.missing{color:var(--none)}
.tag{font-size:11.5px;color:var(--warn);margin-left:6px}
.plain{list-style:none;margin:0;padding:0;font-size:14px}.plain li{padding:6px 0;border-top:1px solid var(--line)}.plain li:first-child{border-top:0}
.how{display:grid;grid-template-columns:110px 1fr;gap:6px 16px;font-size:14px;margin:0 0 12px}.how dt{font-weight:600}.how dd{margin:0;color:var(--ink-2)}
.foot{margin-top:28px;color:var(--ink-3);font-size:12.5px;display:flex;gap:6px 16px;flex-wrap:wrap}
.empty{padding:22px 18px;color:var(--ink-3);margin:0}
@media (max-width:640px){.sum{flex-direction:column-reverse;align-items:flex-start;gap:10px}.head{padding:20px}.bar{flex-direction:column;align-items:stretch}input[type=search]{width:100%}.comp>summary{grid-template-columns:auto 1fr auto}.sc{display:none}.scorebox{text-align:left}}
@media print{.chips,.bar input,.top{display:none}.comp{break-inside:avoid}}
`;

const JS = `
const R = JSON.parse(document.getElementById('data').textContent);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const S = R.summary;
const LABEL = { 'Aligned': 'Aligned', 'Drifted': 'Drifted', 'Broken': 'Broken', 'Missing in code': 'Not built', 'Missing in design': 'Not in Figma' };
const ORDER = { 'Broken': 0, 'Drifted': 1, 'Missing in code': 2, 'Missing in design': 3, 'Aligned': 4 };
const DOT = { 'Broken': 'fail', 'Drifted': 'warn', 'Aligned': 'pass' };
const fmt = (iso) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const owner = (o) => o === 'Both' ? 'Design + dev' : o === 'Dev' ? 'Dev' : 'Design';
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

$('when').textContent = 'Checked ' + fmt(R.meta.generatedAt);
const SC = [['aligned', 'Aligned', 'Aligned'], ['drifted', 'Drifted', 'Drifted'], ['broken', 'Broken', 'Broken'], ['notbuilt', 'Not built', 'Missing in code'], ['notfigma', 'Not in Figma', 'Missing in design']];
const cnt = {}; SC.forEach((x) => { cnt[x[0]] = R.components.filter((c) => c.status === x[2]).length; });
$('meter').innerHTML = SC.filter((x) => cnt[x[0]]).map((x) => '<i class="s-' + x[0] + '" style="flex:' + cnt[x[0]] + '" title="' + cnt[x[0]] + ' ' + x[1].toLowerCase() + '"></i>').join('');
$('meter').setAttribute('role', 'img'); $('meter').setAttribute('aria-label', SC.filter((x) => cnt[x[0]]).map((x) => cnt[x[0]] + ' ' + x[1].toLowerCase()).join(', '));
$('legend').innerHTML = SC.filter((x) => cnt[x[0]]).map((x) => '<li><i class="s-' + x[0] + '"></i>' + x[1] + ' <b>' + cnt[x[0]] + '</b></li>').join('');
$('score').textContent = S.score + '%';
$('headline').textContent = S.headline;
if (R.delta) {
  const d = R.delta.previousScore != null ? S.score - R.delta.previousScore : null;
  $('delta').innerHTML = (d ? '<b class="' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '+' : '') + d + ' points</b> since the last run. ' : '') +
    (R.delta.newFails.length ? plural(R.delta.newFails.length, 'new problem') : 'No new problems') + (R.delta.fixed.length ? ', ' + R.delta.fixed.length + ' fixed.' : '.');
}
if (S.themes.length) $('themes').innerHTML = S.themes.slice(0, 6).map((t) => '<li><span class="dot ' + t.status + '"></span><span class="t">' + esc(t.title) + '</span><span class="who">' + plural(t.components.length, 'component') + ' · ' + owner(t.owner) + '</span></li>').join('');
else $('attention').hidden = true;

const state = { s: '', q: '' };
const present = Object.keys(ORDER).filter((k) => R.components.some((c) => c.status === k));
$('chips').innerHTML = ['<button class="chip" data-s="" aria-pressed="true">All ' + R.components.length + '</button>'].concat(present.map((k) => '<button class="chip" data-s="' + k + '" aria-pressed="false">' + LABEL[k] + ' ' + R.components.filter((c) => c.status === k).length + '</button>')).join('');
$('chips').onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; state.s = b.dataset.s; document.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(); };
$('q').oninput = (e) => { state.q = e.target.value.toLowerCase(); render(); };

function render() {
  const list = R.components.filter((c) => (!state.s || c.status === state.s) && (!state.q || (c.name + ' ' + (c.code ? c.code.title : '')).toLowerCase().includes(state.q)))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.score ?? 101) - (b.score ?? 101) || a.name.localeCompare(b.name));
  $('list').innerHTML = list.length ? list.map((c) => {
    const f = c.checks.filter((x) => x.status === 'fail').length, w = c.checks.filter((x) => x.status === 'warn').length;
    const counts = [f && f + ' failing', w && plural(w, 'warning')].filter(Boolean).join(', ');
    const g = (c.gallery || []).find((x) => x.figma) || (c.gallery || []).find((x) => x.code);
    const thumb = '<span class="thumb' + (g ? '' : ' none') + '" aria-hidden="true">' + (g ? '<img loading="lazy" alt="" src="' + esc(g.figma || g.code) + '">' : '') + '</span>';
    return '<details class="comp" id="c-' + esc(c.key) + '" data-key="' + esc(c.key) + '"><summary>' + thumb + '<span class="nm">' + esc(c.name) + '<small>' + esc(c.code ? c.code.title : 'Only in Figma') + (counts ? ' · ' + counts : '') + '</small></span>' +
      '<span class="st ' + esc(c.status) + '"><span class="dot ' + (DOT[c.status] || '') + '"></span>' + LABEL[c.status] + '</span>' +
      '<span class="sc">' + (c.score != null ? c.score + '%' : '') + '</span></summary><div class="body"></div></details>';
  }).join('') : '<p class="empty">Nothing matches.</p>';
}
document.addEventListener('toggle', (e) => {
  const d = e.target; if (!d.classList || !d.classList.contains('comp') || !d.open) return;
  const b = d.querySelector('.body'); if (b.dataset.done) return;
  b.innerHTML = detail(R.components.find((c) => c.key === d.dataset.key)); b.dataset.done = '1';
}, true);

function where(ch) {
  const p = [];
  if (ch.brands.length) p.push(ch.brands.join(', '));
  if (ch.variants.length) p.push(ch.variants.length > 3 ? ch.variants.length + ' variants' : ch.variants.join('; '));
  return p.length ? (ch.detail ? ' · ' : '') + esc(p.join(' · ')) : '';
}
function detail(c) {
  let h = '<div class="links">' + (c.figma && c.figma.url ? '<a href="' + esc(c.figma.url) + '" target="_blank" rel="noopener">Open in Figma</a>' : '') + (c.code && c.code.url ? '<a href="' + esc(c.code.url) + '" target="_blank" rel="noopener">Open in Storybook</a>' : '') + '</div>';
  if (c.suggestions && c.suggestions.length) h += '<p class="note">Possible matches: ' + esc(c.suggestions.map((s) => s.title || s.name).join(', ')) + '</p>';
  for (const cat of [...new Set(c.checks.map((x) => x.category))]) {
    const items = c.checks.filter((x) => x.category === cat);
    const bad = items.filter((x) => x.status !== 'pass').sort((a, b) => (b.status === 'fail') - (a.status === 'fail'));
    const good = items.filter((x) => x.status === 'pass');
    h += '<div class="grp"><h3>' + esc(cat) + '</h3>' + bad.map((x) => '<div class="ck"><span class="dot ' + x.status + '"></span><span>' + esc(x.title) + '</span><span class="who">' + owner(x.owner) + '</span>' + (x.detail || x.brands.length || x.variants.length ? '<div class="d">' + esc(x.detail || '') + where(x) + '</div>' : '') + '</div>').join('') +
      (good.length ? '<p class="passes">' + good.length + ' passing: ' + esc(good.map((x) => x.label).slice(0, 6).join(', ')) + (good.length > 6 ? '…' : '') + '</p>' : '') + '</div>';
  }
  if (c.props && c.props.props && c.props.props.length) {
    h += '<div class="grp"><h3>Property mapping</h3><table class="map"><thead><tr><th>Figma</th><th>Code</th><th>Values</th></tr></thead><tbody>' + c.props.props.map((p) => '<tr><td>' + esc(p.figma) + '</td><td class="v-' + (p.how === 'state' ? 'exact' : p.how) + '">' + esc(p.how === 'state' ? 'states' : p.codeArg || 'missing') + '</td><td>' +
      p.values.map((v) => '<span class="v-' + (['interaction', 'boolean', 'enum', 'free'].includes(v.how) ? 'exact' : v.how) + '">' + esc(v.figma) + (v.code != null && String(v.code).toLowerCase() !== String(v.figma).toLowerCase() ? ' → ' + esc(v.code) : v.boolArg ? ' → ' + esc(v.boolArg) : '') + '</span>').join(', ') + '</td></tr>').join('') + '</tbody></table></div>';
  }
  const shots = (c.gallery || []).filter((g) => g.figma || g.code).slice(0, 12);
  if (shots.length) h += '<div class="grp"><h3>Side by side, most different first</h3><div class="gal">' + shots.map((g) => '<div class="shot"><p><span>' + esc(g.variant) + '</span><span>' + esc(g.brand || '') + (g.mismatch != null ? ' · ' + Math.round(g.mismatch * 100) + '%' : '') + '</span></p><div class="trio">' + fig('Figma', g.figma) + fig('Code', g.code) + fig('Difference', g.diff) + '</div></div>').join('') + '</div></div>';
  return h;
}
const fig = (cap, src) => '<figure><figcaption>' + cap + '</figcaption>' + (src ? '<img loading="lazy" alt="' + cap + '" src="' + esc(src) + '">' : '') + '</figure>';
render();
if (location.hash.indexOf('#c-') === 0) { const el = document.getElementById(location.hash.slice(1)); if (el) { el.open = true; el.scrollIntoView(); } }

const T = R.tokens; const brands = R.brands.pairs.filter((p) => p.code).map((p) => p.figma);
if (!T.rows.length) { $('tokNote').textContent = 'Token names need a snapshot from the Figma plugin, so only token values were compared in the components above.'; $('tokAllLabel').hidden = true; }
else $('tokNote').textContent = T.summary.match + ' of ' + T.summary.total + ' tokens match in every brand. ' + T.summary.differs + ' differ, ' + T.summary.missing + ' missing in code' + (T.summary.renamed ? ', ' + T.summary.renamed + ' named differently' : '') + '.';
const hex = (v) => /^#|^rgb/i.test(String(v || ''));
function tokens() {
  const all = $('tokAll').checked;
  const rows = T.rows.filter((r) => all || r.status !== 'match' || r.conventional);
  $('tokTable').innerHTML = rows.length ? '<thead><tr><th>Figma</th><th>Code</th>' + brands.map((b) => '<th>' + esc(b) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr><td>' + esc(r.figma) + '</td><td><code>' + esc(r.css) + '</code>' + (r.conventional ? '<span class="tag">renamed</span>' : '') + '</td>' + brands.map((b) => { const v = r.brands[b]; if (!v) return '<td></td>'; return '<td class="' + v.status + '">' + (v.status === 'missing' ? 'not in code' : (hex(v.design) ? '<span class="sw" style="background:' + esc(v.design) + '"></span>' : '') + esc(v.design) + (v.status === 'differs' ? ' → ' + esc(v.code) : '')) + '</td>'; }).join('') + '</tr>').join('') + '</tbody>' : '<tbody><tr><td class="note">Every token matches.</td></tr></tbody>';
}
$('tokAll').onchange = tokens; if (T.rows.length) tokens();
$('brands').innerHTML = R.brands.pairs.map((p) => '<li>' + esc(p.figma) + ' → ' + (p.code ? '<code>' + esc(p.code) + '</code>' : '<span style="color:var(--none)">no Storybook brand, not checked</span>') + '</li>').join('') + R.brands.onlyInCode.map((b) => '<li><code>' + esc(b) + '</code> <span style="color:var(--none)">only in Storybook</span></li>').join('');
const ts = R.meta.figma.tokenSource;
$('foot').innerHTML = '<span>Figma: ' + esc((R.meta.figma.file && R.meta.figma.file.name) || '') + (R.meta.figma.url ? ' (<a href="' + esc(R.meta.figma.url) + '">open</a>)' : '') + '</span><span>Storybook: <a href="' + esc(R.meta.storybook.url) + '">open</a></span>' + (ts ? '<span>Token data from ' + fmt(ts.exportedAt) + (ts.stale ? ', out of date' : '') + '</span>' : '') + '<span><a href="issues.csv">Download issues for Jira (CSV)</a></span>';
`;
