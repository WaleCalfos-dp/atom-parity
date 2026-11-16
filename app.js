/* Atom parity — web app. Talks to the GitHub API with a key stored in this browser only. */
(function () {
  'use strict';
  const REPO = window.ATOM_PARITY.repo;
  const WORKFLOW = 'atom-parity.yml';
  const API = 'https://api.github.com/repos/' + REPO;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ap.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ap.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const ICON = {
    figma: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16l2.5-.5L15 7a1.8 1.8 0 0 0-2.5-2.5L4 13l-.5 2.5z"/><path d="M11.5 5.5l3 3"/></svg>',
    code: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 6l-4 4 4 4M13 6l4 4-4 4"/></svg>',
    rerun: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6M16.5 3.5v4h-4"/></svg>',
    more: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/></svg>',
    x: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>',
  };
  const STATUS = [
    ['aligned', 'Aligned', 'var(--ok)'], ['drifted', 'Drifted', '#E39A2D'], ['broken', 'Broken', 'var(--bad)'],
    ['notbuilt', 'Not built', '#C9C6C2'], ['notfigma', 'Not in Figma', 'var(--info)'],
  ];
  const countsOf = (c) => ({ aligned: c.aligned || 0, drifted: c.drifted || 0, broken: c.broken || 0, notbuilt: c.missingInCode || 0, notfigma: c.missingInDesign || 0 });

  let key = store.get('key', null);
  let status = { entries: [] };
  // Runs started from this browser
  // (entries saved by older versions of this page are dropped)
  let runs = store.get('runs', []).filter((r) => r && r.req && r.kind && ['waiting', 'running', 'publishing', 'done', 'failed'].includes(r.state) && Date.now() - r.startedAt < 3 * 3600000);
  const saveRuns = () => store.set('runs', runs.slice(0, 12));
  const auth = (k) => (k ? { Authorization: 'Bearer ' + k, Accept: 'application/vnd.github+json' } : { Accept: 'application/vnd.github+json' });

  // ------------------------------------------------------------- time
  function ago(t) {
    const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = Math.round(h / 24); return d === 1 ? 'yesterday' : d + ' days ago';
  }
  function nextNightly() {
    const n = new Date(); const t = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 2, 17));
    while (t <= n || t.getUTCDay() === 0 || t.getUTCDay() === 6) t.setUTCDate(t.getUTCDate() + 1);
    const time = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const days = Math.round((new Date(t.toDateString()) - new Date(n.toDateString())) / 86400000);
    return (days === 0 ? 'today' : days === 1 ? (t.getHours() < 6 ? 'tonight' : 'tomorrow') : t.toLocaleDateString('en-GB', { weekday: 'long' })) + ' at ' + time;
  }

  // ------------------------------------------------------------- GitHub connection
  const dlg = $('connect');
  function renderConn() {
    const b = $('connBtn');
    b.className = 'conn ' + (key ? 'on' : 'off');
    $('connLabel').textContent = key ? 'Connected to GitHub' : 'Connect GitHub';
    $('forget').hidden = !key;
  }
  function openConnect(reason, isError) {
    $('keyErr').textContent = reason || '';
    $('keyErr').className = isError ? 'err' : 'note';
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    setTimeout(() => $('key').focus(), 30);
  }
  $('connBtn').addEventListener('click', () => openConnect());
  $('closeDlg').addEventListener('click', () => dlg.close());
  $('keyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('key').value.trim();
    $('keyErr').textContent = '';
    $('keyErr').className = 'err';
    if (!v) { $('keyErr').textContent = 'Paste the key first.'; return; }
    $('saveKey').disabled = true;
    const r = await fetch(API + '/actions/workflows/' + WORKFLOW, { headers: auth(v) }).catch(() => null);
    $('saveKey').disabled = false;
    if (!r) { $('keyErr').textContent = "Couldn't reach GitHub. Check your connection and try again."; return; }
    if (r.status === 401) { $('keyErr').textContent = "GitHub doesn't recognise that key. Check you copied all of it."; return; }
    if (!r.ok) { $('keyErr').textContent = "That key can't see this repository. Check step 2."; return; }
    key = v; store.set('key', v); $('key').value = ''; renderConn(); dlg.close();
    if (pendingAfterConnect) { const f = pendingAfterConnect; pendingAfterConnect = null; f(); }
  });
  $('forget').addEventListener('click', () => { key = null; store.set('key', null); renderConn(); dlg.close(); });
  let pendingAfterConnect = null;

  // ------------------------------------------------------------- start runs
  async function dispatch(inputs, label, checkId) {
    if (!key) { pendingAfterConnect = () => dispatch(inputs, label, checkId); openConnect('Connect GitHub once to run checks from this browser.'); return 'later'; }
    const req = Math.random().toString(36).slice(2, 10);
    const r = await fetch(API + '/actions/workflows/' + WORKFLOW + '/dispatches', {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth(key)),
      body: JSON.stringify({ ref: 'main', inputs: Object.assign({}, inputs, { request_id: req }) }),
    }).catch(() => null);
    if (!r) return "Couldn't reach GitHub. Check your connection and try again.";
    if (r.status === 401) { key = null; store.set('key', null); renderConn(); pendingAfterConnect = () => dispatch(inputs, label, checkId); openConnect('Your key has expired or was revoked. Add a new one.', true); return 'later'; }
    if (r.status === 403 || r.status === 404) { pendingAfterConnect = () => dispatch(inputs, label, checkId); openConnect("Your key can't run checks. It needs Actions: Read and write (step 3).", true); return 'later'; }
    if (r.status !== 204) return 'GitHub said ' + r.status + '. Try again in a minute.';
    runs.unshift({ req: req, label: label, checkId: checkId, kind: inputs.remove_id ? 'remove' : 'run', startedAt: Date.now(), state: 'waiting', step: 0 });
    saveRuns(); renderRuns(); renderChecks(); poll();
    return true;
  }

  function checkIdFor(name, figmaUrl) {
    let base = name;
    if (!base) {
      const u = new URL(figmaUrl);
      const m = u.pathname.match(/\/(?:design|file|proto)\/([0-9A-Za-z]{10,})(?:\/branch\/([0-9A-Za-z]{10,}))?/);
      const node = u.searchParams.get('node-id');
      base = 'figma-' + (node ? node.replace('-', ':') : (m ? (m[2] || m[1]) : 'file'));
    }
    const k = base.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[\s_/.]+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    return k.slice(0, 80) || 'x';
  }

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = $('figma'), s = $('sb'), n = $('name');
    [f, s].forEach((x) => x.removeAttribute('aria-invalid'));
    $('formErr').textContent = '';
    let figmaOk = false; try { const u = new URL(f.value.trim()); figmaOk = /(^|\.)figma\.com$/.test(u.hostname) && /\/(design|file)\//.test(u.pathname); } catch (err) { /* invalid */ }
    let sbOk = false; try { const u = new URL(s.value.trim()); sbOk = /^https?:$/.test(u.protocol); } catch (err) { /* invalid */ }
    if (!figmaOk) { f.setAttribute('aria-invalid', 'true'); $('formErr').textContent = 'Paste a Figma design link, like figma.com/design/…'; f.focus(); return; }
    if (!sbOk) { s.setAttribute('aria-invalid', 'true'); $('formErr').textContent = 'Paste the Storybook link, starting with https://'; s.focus(); return; }
    $('runBtn').disabled = true;
    const name = n.value.trim();
    store.set('storybook', s.value.trim());
    const res = await dispatch({ name: name, figma_url: f.value.trim(), storybook_url: s.value.trim() }, name || 'New check', checkIdFor(name, f.value.trim()));
    $('runBtn').disabled = false;
    if (res === true) { f.value = ''; n.value = ''; }
    else if (res !== 'later') $('formErr').textContent = res;
  });

  // ------------------------------------------------------------- follow runs
  const STEPS = ['Queued', 'Preparing', 'Comparing', 'Publishing'];
  const stepOf = (name) => (/compare/i.test(name) ? 2 : /publish/i.test(name) ? 3 : 1);
  let pollTimer = null;
  async function poll() {
    clearTimeout(pollTimer);
    const active = runs.filter((r) => r.state === 'waiting' || r.state === 'running' || r.state === 'publishing');
    if (!active.length) return;
    try {
      if (active.some((r) => !r.runId)) {
        const list = await fetch(API + '/actions/workflows/' + WORKFLOW + '/runs?event=workflow_dispatch&per_page=20', { headers: auth(key) }).then((x) => x.json());
        const wf = list.workflow_runs || [];
        const claimed = new Set(runs.map((r) => r.runId).filter(Boolean));
        active.filter((r) => !r.runId).sort((a, b) => a.startedAt - b.startedAt).forEach((r) => {
          // GitHub titles a run only once it starts; before that, match untitled runs by time.
          let hit = wf.find((w) => (w.display_title || '').indexOf('[' + r.req + ']') !== -1);
          if (!hit) hit = wf.filter((w) => !claimed.has(w.id) && !/\[[a-z0-9]{6,}\]/.test(w.display_title || '') && w.status !== 'completed' && new Date(w.created_at).getTime() >= r.startedAt - 20000)
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
          if (hit) { r.runId = hit.id; claimed.add(hit.id); }
        });
      }
      for (const r of active) {
        if (!r.runId) { if (Date.now() - r.startedAt > 5 * 60000) fail(r, "GitHub didn't accept the check. Try again in a few minutes."); continue; }
        if (r.state === 'publishing') { await waitForSite(r); continue; }
        const run = await fetch(API + '/actions/runs/' + r.runId, { headers: auth(key) }).then((x) => x.json());
        r.url = run.html_url;
        if (run.status === 'completed') {
          if (run.conclusion === 'success' || run.conclusion === 'failure') { r.state = 'publishing'; r.step = 3; r.conclusion = run.conclusion; r.completedAt = Date.now(); }
          else fail(r, run.conclusion === 'cancelled' ? 'The check was cancelled.' : 'The check stopped (' + run.conclusion + ').');
        } else if (run.status === 'queued' || run.status === 'waiting' || run.status === 'pending') {
          r.state = 'waiting'; r.step = 0;
          if (Date.now() - r.startedAt > 30 * 60000) fail(r, 'GitHub queued the check but never started it. Try again later.');
        } else {
          r.state = 'running';
          const jobs = await fetch(API + '/actions/runs/' + r.runId + '/jobs', { headers: auth(key) }).then((x) => x.json());
          const steps = (jobs.jobs && jobs.jobs[0] && jobs.jobs[0].steps) || [];
          const cur = steps.find((s) => s.status === 'in_progress') || steps.filter((s) => s.status === 'completed').pop();
          r.step = cur ? stepOf(cur.name) : 1;
        }
      }
    } catch (e) { /* network blip: try again next tick */ }
    saveRuns(); renderRuns(); renderChecks();
    if (runs.some((r) => r.state === 'waiting' || r.state === 'running' || r.state === 'publishing')) pollTimer = setTimeout(poll, document.hidden ? 30000 : 6000);
  }
  function fail(r, msg) { r.state = 'failed'; r.msg = msg; r.finishedAt = Date.now(); }
  async function waitForSite(r) {
    await loadStatus();
    const fresh = status.generatedAt && new Date(status.generatedAt).getTime() > r.startedAt;
    if (fresh || Date.now() - (r.completedAt || r.startedAt) > 5 * 60000) {
      r.state = r.kind === 'remove' ? 'done' : r.conclusion === 'failure' ? 'failed' : 'done';
      if (r.state === 'failed') r.msg = 'Finished, but some checks found new problems or couldn’t run. See the cards below.';
      r.finishedAt = Date.now();
      renderOverview(); renderChecks();
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  function renderRuns() {
    const show = runs.filter((r) => !r.dismissed && (r.state !== 'done' || Date.now() - r.finishedAt < 15 * 60000) && (r.state !== 'failed' || Date.now() - r.finishedAt < 60 * 60000)).slice(0, 4);
    $('runs').innerHTML = show.map((r) => {
      const mins = Math.max(0, Math.round((Date.now() - r.startedAt) / 60000));
      const entry = r.state === 'done' && r.kind !== 'remove' && status.entries.find((e) => e.id === r.checkId || (r.label && e.name === r.label));
      const title = r.kind === 'remove' ? 'Removing ' + esc(r.label) : esc(r.label);
      let sub = '';
      if (r.state === 'done') sub = r.kind === 'remove' ? 'Removed' : 'Report ready';
      else if (r.state === 'failed') sub = '';
      else sub = (r.state === 'waiting' && mins >= 3 ? 'Waiting for GitHub, which can be busy' : STEPS[r.step || 0]) + ' · ' + mins + ' min';
      const steps = r.state === 'failed' || r.kind === 'remove' ? '' : '<ol class="steps" aria-label="Progress">' + STEPS.map((s, i) => '<li class="' + (r.state === 'done' || i < r.step ? 'done' : i === r.step ? 'now' : '') + '">' + s + '</li>').join('') + '</ol>';
      return '<div class="run ' + r.state + '" data-req="' + esc(r.req) + '"><div class="who">' + title + '<span>' + esc(sub) + '</span></div><div class="right">' +
        (entry ? '<a class="btn small" href="' + esc(entry.id) + '/">Open report</a>' : r.state === 'failed' && r.url ? '<a class="btn small quiet" href="' + esc(r.url) + '" target="_blank" rel="noopener">Details</a>' : '') +
        '<button class="x" data-dismiss="' + esc(r.req) + '" aria-label="Dismiss">' + ICON.x + '</button></div>' + steps +
        (r.state === 'failed' ? '<p class="msg">' + esc(r.msg || 'Something went wrong.') + '</p>' : '') + '</div>';
    }).join('');
  }
  $('runs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dismiss]'); if (!b) return;
    const r = runs.find((x) => x.req === b.dataset.dismiss); if (r) r.dismissed = true;
    saveRuns(); renderRuns();
  });

  // ------------------------------------------------------------- status
  async function loadStatus() {
    try { const r = await fetch('checks-status.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) status = await r.json(); } catch (e) { /* offline */ }
    return status;
  }

  function meter(c, cls) {
    const total = STATUS.reduce((n, s) => n + c[s[0]], 0);
    if (!total) return '<div class="meter ' + (cls || '') + '"></div>';
    return '<div class="meter ' + (cls || '') + '" role="img" aria-label="' + STATUS.filter((s) => c[s[0]]).map((s) => c[s[0]] + ' ' + s[1].toLowerCase()).join(', ') + '">' +
      STATUS.filter((s) => c[s[0]]).map((s) => '<i class="s-' + s[0] + '" style="flex:' + c[s[0]] + '"></i>').join('') + '</div>';
  }

  function renderOverview() {
    const es = (status.entries || []).filter((e) => e.ok);
    const box = $('overview');
    if (!es.length) { box.hidden = true; return; }
    box.hidden = false;
    // Each component once, even if two checks cover it (latest result wins)
    const seen = new Map();
    es.slice().sort((a, b) => new Date(a.ranAt) - new Date(b.ranAt)).forEach((e) => (e.components || []).forEach((c) => seen.set(c.name, c.status)));
    const c = { aligned: 0, drifted: 0, broken: 0, notbuilt: 0, notfigma: 0 };
    if (seen.size) seen.forEach((st) => { c[{ Aligned: 'aligned', Drifted: 'drifted', Broken: 'broken', 'Missing in code': 'notbuilt', 'Missing in design': 'notfigma' }[st]]++; });
    else es.forEach((e) => { const k = countsOf(e.counts || {}); Object.keys(c).forEach((x) => { c[x] += k[x]; }); });
    const figmaTotal = c.aligned + c.drifted + c.broken + c.notbuilt;
    const need = c.drifted + c.broken + c.notbuilt;
    $('ovTitle').innerHTML = figmaTotal ? (need ? need + ' of ' + figmaTotal + ' components <em>need attention</em>' : 'All ' + figmaTotal + ' components match Figma') : 'No components checked yet';
    const last = es.map((e) => e.ranAt).filter(Boolean).sort().pop();
    $('ovMeta').innerHTML = es.length + ' check' + (es.length === 1 ? '' : 's') + (last ? ' · last run ' + ago(last) : '') + '<br>Next automatic run ' + nextNightly();
    $('ovMeter').innerHTML = meter(c);
    $('ovLegend').innerHTML = STATUS.filter((s) => c[s[0]] || s[0] !== 'notfigma').map((s) => '<li><i class="s-' + s[0] + '"></i>' + s[1] + ' <b>' + c[s[0]] + '</b></li>').join('');
  }

  function spark(h) {
    if (!h || h.length < 2) return '';
    const pts = h.slice(-12); const w = 84, hh = 24, pad = 3;
    const xs = (i) => pad + (i * (w - 2 * pad)) / (pts.length - 1);
    const ys = (v) => hh - pad - (v / 100) * (hh - 2 * pad);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + xs(i).toFixed(1) + ' ' + ys(p.score).toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + hh + '" role="img" aria-label="Score trend over the last ' + pts.length + ' runs"><path d="' + d + '" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="' + xs(pts.length - 1).toFixed(1) + '" cy="' + ys(last.score).toFixed(1) + '" r="2.5" fill="var(--ink)"/></svg>';
  }

  const openMenus = new Set(); const confirming = new Set();
  function renderChecks() {
    const es = status.entries || [];
    $('count').textContent = es.length ? es.length : '';
    $('runAll').hidden = es.length < 2;
    const running = new Map(runs.filter((r) => r.state === 'waiting' || r.state === 'running' || r.state === 'publishing').map((r) => [r.checkId, r]));
    if (!es.length) { $('grid').innerHTML = '<div class="empty-state"><b>No checks yet</b>Paste a Figma link and a Storybook link above to run the first one.</div>'; return; }
    $('grid').innerHTML = es.map((e) => {
      const isRunning = running.has(e.id);
      const name = esc(e.name || e.id);
      const menu = openMenus.has(e.id) ? '<div class="menu-list" role="menu">' + (e.figmaUrl ? '<a role="menuitem" href="' + esc(e.figmaUrl) + '" target="_blank" rel="noopener">Open in Figma</a>' : '') + (e.storybookUrl ? '<a role="menuitem" href="' + esc(e.storybookUrl) + '" target="_blank" rel="noopener">Open in Storybook</a>' : '') + (e.ok ? '<a role="menuitem" href="' + esc(e.id) + '/issues.csv">Download issues (Jira CSV)</a>' : '') + '<button role="menuitem" class="danger" data-act="remove">Remove check</button></div>' : '';
      const foot = '<div class="foot"><span class="when">' + (e.ranAt ? 'Checked ' + ago(e.ranAt) : 'Not run yet') + '</span>' +
        (e.ok ? '<a class="btn small" href="' + esc(e.id) + '/">Open report</a>' : '') +
        '<button class="iconbtn" data-act="run" aria-label="Run ' + name + ' again" title="Run again"' + (isRunning ? ' disabled' : '') + '>' + ICON.rerun + '</button>' +
        '<div class="menu"><button class="iconbtn" data-act="menu" aria-haspopup="menu" aria-expanded="' + openMenus.has(e.id) + '" aria-label="More for ' + name + '">' + ICON.more + '</button>' + menu + '</div></div>';
      const confirm = confirming.has(e.id) ? '<div class="confirm"><p>Remove <b>' + name + '</b> and its report? Nightly runs stop too.</p><button class="btn small danger" data-act="remove-yes">Remove</button><button class="btn small quiet" data-act="remove-no">Keep</button></div>' : '';
      const tag = isRunning ? '<div class="running-tag">Running now</div>' : '';
      if (e.ok === false) {
        return '<article class="card failed" data-id="' + esc(e.id) + '"><div class="top"><div><h4>' + name + '</h4>' + tag + '</div></div><p class="err">Couldn’t run: ' + esc(e.error) + '</p>' + confirm + foot + '</article>';
      }
      if (!e.ok) {
        return '<article class="card" data-id="' + esc(e.id) + '"><div class="top"><div><h4>' + name + '</h4>' + tag + '</div></div><p class="pending">' + (isRunning ? 'The first report is on its way.' : 'Not run yet.') + '</p>' + confirm + foot + '</article>';
      }
      const k = countsOf(e.counts || {});
      const d = e.previousScore != null && e.score !== e.previousScore ? e.score - e.previousScore : null;
      const p = e.preview;
      const pair = p ? '<div class="pair"><figure><figcaption>' + ICON.figma + 'Figma</figcaption><div class="img"><img loading="lazy" alt="' + esc(p.component) + ' in Figma" src="' + esc(p.figma) + '"></div></figure><figure><figcaption>' + ICON.code + 'Storybook</figcaption><div class="img"><img loading="lazy" alt="' + esc(p.component) + ' in Storybook" src="' + esc(p.code) + '"></div></figure></div>' +
        '<p class="caption">Most different: <b>' + esc(p.component) + '</b> · ' + esc(String(p.variant || '').split(',').map((x) => x.split('=').pop().trim()).join(', ')) + (p.brand ? ' · ' + esc(p.brand) : '') + (p.mismatch != null ? ' · ' + Math.round(p.mismatch * 100) + '% of pixels differ' : '') + '</p>'
        : '<div class="pair empty">' + (k.notbuilt && !k.aligned && !k.drifted && !k.broken ? 'None of these components are in Storybook yet.' : 'No side-by-side pictures for this check.') + '</div>';
      const counts = STATUS.filter((s) => k[s[0]]).map((s) => '<span><i style="background:' + s[2] + '"></i>' + k[s[0]] + ' ' + s[1].toLowerCase() + '</span>').join('');
      return '<article class="card" data-id="' + esc(e.id) + '"><div class="top"><div><h4><a href="' + esc(e.id) + '/">' + name + '</a></h4><div class="sub">' + esc(e.headline || '') + '</div>' + tag + '</div>' +
        '<div class="score"><b>' + e.score + '%</b><small>parity</small>' + (d ? '<br><span class="delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '+' : '') + d + '</span>' : '') + '</div></div>' +
        pair + '<div class="stat">' + meter(k) + '<div class="row"><div class="counts">' + counts + '</div>' + spark(e.history) + '</div></div>' + confirm + foot + '</article>';
    }).join('');
  }

  $('grid').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const card = b.closest('.card'); const id = card.dataset.id; const e = status.entries.find((x) => x.id === id) || {};
    const act = b.dataset.act;
    if (act === 'menu') { if (openMenus.has(id)) openMenus.delete(id); else { openMenus.clear(); openMenus.add(id); } renderChecks(); return; }
    openMenus.clear();
    if (act === 'run') { const r = await dispatch({ check_id: id }, e.name || id, id); if (typeof r === 'string' && r !== 'later') flash(card, r); }
    if (act === 'remove') { confirming.add(id); renderChecks(); }
    if (act === 'remove-no') { confirming.delete(id); renderChecks(); }
    if (act === 'remove-yes') { confirming.delete(id); const r = await dispatch({ remove_id: id }, e.name || id, id); if (typeof r === 'string' && r !== 'later') flash(card, r); renderChecks(); }
  });
  document.addEventListener('click', (ev) => { if (openMenus.size && !ev.target.closest('.menu')) { openMenus.clear(); renderChecks(); } });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && openMenus.size) { openMenus.clear(); renderChecks(); } });
  function flash(card, msg) { const p = document.createElement('p'); p.className = 'err'; p.setAttribute('role', 'alert'); p.textContent = msg; card.insertBefore(p, card.querySelector('.foot')); }
  $('runAll').addEventListener('click', () => dispatch({}, 'All checks', null));

  // ------------------------------------------------------------- start
  function commonStorybook() {
    const saved = store.get('storybook', null); if (saved) return saved;
    const counts = {}; (status.entries || []).forEach((e) => { if (e.storybookUrl) { const u = e.storybookUrl.split('?')[0]; counts[u] = (counts[u] || 0) + 1; } });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
  }
  renderConn();
  loadStatus().then(() => {
    if (!$('sb').value) $('sb').value = commonStorybook();
    renderOverview(); renderRuns(); renderChecks(); poll();
  });
  setInterval(() => { renderRuns(); }, 30000);
})();
