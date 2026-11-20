/* Atom parity — web app. Actions go through the team relay with the person's name (no GitHub account needed);
   a GitHub key in this browser is only a fallback for the site owner when no relay is set up. */
(function () {
  'use strict';
  // Which GitHub repository runs the checks. Falls back to the site address (owner.github.io/repo).
  const fromHost = /\.github\.io$/i.test(location.hostname) && location.pathname.split('/')[1] ? location.hostname.split('.')[0] + '/' + location.pathname.split('/')[1] : null;
  const REPO = (window.ATOM_PARITY && window.ATOM_PARITY.repo) || fromHost;
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

  // ------------------------------------------------------------- who is acting: a name (through the relay), or a GitHub key (fallback)
  let RELAY = null;
  let myName = store.get('name', '') || '';
  const dlg = $('connect');
  function renderConn() {
    const b = $('connBtn');
    if (RELAY) {
      b.className = 'conn ' + (myName ? 'on name' : 'off');
      $('connLabel').textContent = myName || 'Add your name';
      b.setAttribute('aria-label', myName ? 'Acting as ' + myName + '. Change name' : 'Add your name');
      return;
    }
    b.className = 'conn ' + (key ? 'on' : 'off');
    $('connLabel').textContent = key ? 'Connected to GitHub' : 'Connect GitHub';
    $('forget').hidden = !key;
  }
  const relayReady = fetch('relay.json?ts=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((j) => { RELAY = j && j.url ? String(j.url).replace(/\/$/, '') : null; renderConn(); return RELAY; });
  let pendingAfterName = null;
  function askName(then) {
    pendingAfterName = then || null;
    $('nameInput').value = myName; $('nameErr').textContent = '';
    $('nameDlg').showModal(); setTimeout(() => $('nameInput').focus(), 30);
  }
  $('nameForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('nameInput').value.trim();
    if (!v) { $('nameErr').textContent = 'Add your name, so the team can see who made each change.'; return; }
    myName = v.slice(0, 80); store.set('name', myName); renderConn(); $('nameDlg').close();
    if (pendingAfterName) { const f = pendingAfterName; pendingAfterName = null; f(); }
  });
  $('nameCancel').addEventListener('click', () => { pendingAfterName = null; $('nameDlg').close(); });
  // Read run progress: through the relay, or straight from GitHub with the fallback key
  const ghGet = (path) => (RELAY ? fetch(RELAY + '/gh?path=' + encodeURIComponent(path)) : fetch(API + path, { headers: auth(key) })).then((x) => x.json());
  function openConnect(reason, isError) {
    $('keyErr').textContent = reason || '';
    $('keyErr').className = isError ? 'err' : 'note';
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    setTimeout(() => $('key').focus(), 30);
  }
  $('connBtn').addEventListener('click', () => (RELAY ? askName() : openConnect()));
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
    await relayReady;
    if (RELAY) return relayDispatch(inputs, label, checkId);
    if (!REPO) return "This page doesn't know which GitHub repository runs the checks. Republish the site from GitHub Actions.";
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

  async function relayDispatch(inputs, label, checkId) {
    if (!myName) { askName(() => dispatch(inputs, label, checkId)); return 'later'; }
    const req = Math.random().toString(36).slice(2, 10);
    const body = inputs.remove_id ? { action: 'remove-check', check: inputs.remove_id }
      : inputs.figma_url ? { action: 'add-check', figmaUrl: inputs.figma_url, storybookUrl: inputs.storybook_url, checkName: inputs.name || '' }
      : inputs.check_id ? { action: 'run', check: inputs.check_id } : { action: 'run-all' };
    const r = await fetch(RELAY + '/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign(body, { name: myName, request_id: req })) }).catch(() => null);
    if (!r) return "Couldn't reach the Atom parity relay. Check your connection and try again.";
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return j.error || 'The relay said ' + r.status + '. Try again in a minute.';
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
        const list = await ghGet('/actions/workflows/' + WORKFLOW + '/runs?event=workflow_dispatch&per_page=20');
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
        const run = await ghGet('/actions/runs/' + r.runId);
        r.url = run.html_url;
        if (run.status === 'completed') {
          if (run.conclusion === 'success' || run.conclusion === 'failure') { r.state = 'publishing'; r.step = 3; r.conclusion = run.conclusion; r.completedAt = Date.now(); }
          else fail(r, run.conclusion === 'cancelled' ? 'The check was cancelled.' : 'The check stopped (' + run.conclusion + ').');
        } else if (run.status === 'queued' || run.status === 'waiting' || run.status === 'pending') {
          r.state = 'waiting'; r.step = 0;
          if (Date.now() - r.startedAt > 30 * 60000) fail(r, 'GitHub queued the check but never started it. Try again later.');
        } else {
          r.state = 'running';
          const jobs = await ghGet('/actions/runs/' + r.runId + '/jobs');
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
      else sub = (r.state === 'waiting' && mins >= 3 ? 'Waiting for GitHub, which can be busy' : STEPS[r.step || 0]) + ', ' + (mins < 1 ? 'just started' : mins + ' min so far');
      const steps = r.state === 'failed' || r.kind === 'remove' ? '' : '<ol class="steps" aria-label="Progress">' + STEPS.map((s, i) => '<li class="' + (r.state === 'done' || i < r.step ? 'done' : i === r.step ? 'now' : '') + '">' + s + '</li>').join('') + '</ol>';
      return '<div class="run ' + r.state + '" data-req="' + esc(r.req) + '"><div class="who">' + title + '<span>' + esc(sub) + '</span></div><div class="right">' +
        (entry ? '<a class="btn small" href="' + esc(entry.id) + '/">Open report</a>' : r.state === 'failed' && r.url ? '<a class="btn small ghost" href="' + esc(r.url) + '" target="_blank" rel="noopener">Details on GitHub</a>' : '') +
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

  // Two registration plates: cyan is Figma, magenta is Storybook. The further apart, the more they differ.
  function regMark(score, settle) {
    const off = Math.max(0, Math.min(100, 100 - (score || 0))) * 0.16;
    const plate = (cls, d) => '<g class="plate ' + cls + '" style="--d:' + d.toFixed(2) + 'px"><circle cx="80" cy="80" r="46"/><circle cx="80" cy="80" r="15"/><path d="M80 14v132M14 80h132"/></g>';
    return '<svg class="reg' + (settle ? ' settle' : '') + '" viewBox="0 0 160 160" aria-hidden="true">' + plate('pd', -off) + plate('pc', off) + '</svg>';
  }
  const SEV = ['critical', 'serious', 'moderate', 'minor'];
  const sevList = (counts, max) => SEV.filter((k) => counts && counts[k]).slice(0, max || 4).map((k) => '<span class="sev ' + k + '">' + counts[k] + ' ' + k + '</span>').join('');
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const SHIELD = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.5l6 2.3v4.6c0 3.9-2.6 6.9-6 8.1-3.4-1.2-6-4.2-6-8.1V4.8z"/><circle cx="10" cy="7.3" r="1.2" fill="currentColor" stroke="none"/><path d="M7 9.6l3 .7 3-.7M10 10.3v2.4M8.4 15l1.6-2.3 1.6 2.3"/></svg>';

  // Team activity: who ignored or restored what, across every check
  let activityAll = false, activityLog = null;
  function renderActivity() {
    const el = $('activity'); if (!el) return;
    if (!activityLog) return;
    if (!activityLog.length) { el.innerHTML = '<li class="none">No activity yet. When someone runs a check, or ignores, restores or comments on an issue, it shows here with their name.</li>'; return; }
    const shown = activityAll ? activityLog : activityLog.slice(0, 10);
    el.innerHTML = shown.map((x) => {
      const names = [...new Set((x.items || []).map((i) => i.componentName))];
      const title = x.items && x.items.length && x.items.every((i) => i.title === x.items[0].title) ? x.items[0].title : plural((x.items || []).length, 'issue');
      const who = esc(x.by || x.github || 'Someone') + (x.github && x.by && x.github.toLowerCase() !== String(x.by).toLowerCase() ? ' <span class="gh">@' + esc(x.github) + '</span>' : '');
      if (['run', 'run-all', 'add-check', 'remove-check'].indexOf(x.action) >= 0) {
        const nm = x.checkName || (((status && status.entries) || []).find((e) => e.id === x.check) || {}).name || x.check;
        const what = x.action === 'run-all' ? 'ran every check' : (x.action === 'run' ? 'ran ' : x.action === 'add-check' ? 'added the check ' : 'removed the check ') + (x.action === 'remove-check' ? esc(nm) : '<a href="' + esc(x.check) + '/">' + esc(nm) + '</a>');
        return '<li class="ev-' + esc(x.action) + isNew(x) + '"><span class="dot" aria-hidden="true"></span><div><p><b>' + esc(x.by || 'Someone') + '</b> ' + what + '.</p><time datetime="' + esc(x.at) + '">' + ago(x.at).replace(/^./, (c) => c.toUpperCase()) + '</time></div></li>';
      }
      const verb = { ignore: 'ignored', restore: 'restored', comment: 'commented on', 'delete-comment': 'deleted a comment on' }[x.action] || x.action;
      const said = x.action === 'comment' ? x.text : x.reason;
      return '<li class="ev-' + esc(x.action) + isNew(x) + '"><span class="dot" aria-hidden="true"></span><div><p><b>' + who + '</b> ' + verb + ' <b>' + esc(title) + '</b> for ' + esc(names.length > 3 ? plural(names.length, 'component') : names.join(', ')) + ' in <a href="' + esc(x.check) + '/' + (x.action === 'ignore' || x.action === 'restore' ? '#archive' : '') + '">' + esc(x.checkName || x.check) + '</a>.' + (said ? ' <q>' + esc(said) + '</q>' : '') + '</p><time datetime="' + esc(x.at) + '">' + ago(x.at).replace(/^./, (c) => c.toUpperCase()) + '</time></div></li>';
    }).join('') + (activityLog.length > shown.length ? '<li class="none"><button type="button" class="linkbtn" id="actMore">Show all ' + activityLog.length + ' entries</button></li>' : '');
    const m = $('actMore'); if (m) m.onclick = () => { activityAll = true; renderActivity(); };
  }
  // The menu in the top bar: a count of what's new since you last opened it, refreshed every minute
  let seenAt = store.get('actSeen', null);
  let lastSeen = seenAt;
  const isNew = (x) => (lastSeen && x.at > lastSeen ? ' new' : '');
  function renderUnread() {
    const n = (activityLog || []).filter((x) => !seenAt || x.at > seenAt).length;
    const u = $('actUnread'); const b = $('actBtn');
    u.hidden = !n || !seenAt; u.textContent = n > 9 ? '9+' : String(n);
    b.setAttribute('aria-label', 'Team activity' + (n && seenAt ? ', ' + n + ' new' : ''));
  }
  function loadActivity() {
    return fetch('activity.json?ts=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
      if (!j) { if (!activityLog) { activityLog = []; renderActivity(); } return; }
      activityLog = j.log || [];
      if (!seenAt) { seenAt = activityLog[0] ? activityLog[0].at : new Date().toISOString(); store.set('actSeen', seenAt); lastSeen = seenAt; }
      renderActivity(); renderUnread();
    });
  }
  loadActivity(); setInterval(() => { if (!document.hidden) loadActivity(); }, 60000);
  function setActOpen(open, focusBack) {
    $('actPanel').hidden = !open; $('actBtn').setAttribute('aria-expanded', String(open));
    if (open) {
      lastSeen = seenAt; renderActivity();
      if (activityLog && activityLog[0]) { seenAt = activityLog[0].at; store.set('actSeen', seenAt); }
      renderUnread();
    } else if (focusBack) $('actBtn').focus();
  }
  $('actBtn').addEventListener('click', () => setActOpen($('actPanel').hidden));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('actPanel').hidden) setActOpen(false, true); });
  document.addEventListener('click', (e) => { if (!$('actPanel').hidden && !e.target.closest('.actmenu')) setActOpen(false); });

  let settled = false;
  function renderOverview() {
    const es = (status.entries || []).filter((e) => e.ok);
    if (!es.length) {
      $('ovTitle').textContent = 'Storybook compared with Figma';
      $('ovLede').textContent = 'Paste a Figma page and its Storybook below to run the first check. Each one compares names, properties, tokens, looks and accessibility across every brand.';
      $('ovFacts').innerHTML = ''; $('ovMeter').innerHTML = ''; $('ovLegend').innerHTML = '';
      $('ovMark').innerHTML = regMark(0, false) + '<figcaption><i class="k-d"></i>Figma and <i class="k-c"></i>Storybook</figcaption>';
      return;
    }
    // Each component once, even if two checks cover it (latest result wins)
    const seen = new Map();
    es.slice().sort((a, b) => new Date(a.ranAt) - new Date(b.ranAt)).forEach((e) => (e.components || []).forEach((c) => seen.set(c.name, c)));
    const c = { aligned: 0, drifted: 0, broken: 0, notbuilt: 0, notfigma: 0 };
    let sum = 0, n = 0;
    if (seen.size) seen.forEach((x) => { const k = { Aligned: 'aligned', Drifted: 'drifted', Broken: 'broken', 'Missing in code': 'notbuilt', 'Missing in design': 'notfigma' }[x.status]; if (!k) return; c[k]++; if (x.status !== 'Missing in design') { sum += x.score || 0; n++; } });
    else es.forEach((e) => { const k = countsOf(e.counts || {}); Object.keys(c).forEach((x) => { c[x] += k[x]; }); sum += (e.score || 0) * ((e.counts && e.counts.figma) || 1); n += (e.counts && e.counts.figma) || 1; });
    const score = n ? Math.round(sum / n) : 0;
    const figmaTotal = c.aligned + c.drifted + c.broken + c.notbuilt;
    $('ovTitle').innerHTML = 'Storybook is a <span class="num">' + score + '%</span> match for Figma';
    const built = c.aligned + c.drifted + c.broken;
    $('ovLede').textContent = figmaTotal
      ? (built ? built + ' of ' + figmaTotal + ' Figma components are built in Storybook' + (c.aligned ? ', and ' + c.aligned + ' match exactly.' : ', and none match exactly yet.') : 'None of the ' + figmaTotal + ' Figma components checked are in Storybook yet.')
      : 'No components checked yet.';
    // Accessibility across all checks
    const a = { total: 0, counts: { critical: 0, serious: 0, moderate: 0, minor: 0 }, comps: 0, ran: false, worst: null };
    es.forEach((e) => { if (!e.a11y) return; a.ran = a.ran || e.a11y.ran; a.total += e.a11y.total || 0; a.comps += e.a11y.components || 0; SEV.forEach((k) => { a.counts[k] += (e.a11y.counts && e.a11y.counts[k]) || 0; }); if (e.a11y.total && (!a.worst || (e.a11y.counts.critical || 0) > (a.worst.a11y.counts.critical || 0))) a.worst = e; });
    const last = es.map((e) => e.ranAt).filter(Boolean).sort().pop();
    const facts = [
      a.ran ? '<li><a href="' + (a.worst ? esc(a.worst.id) + '/#accessibility' : '#checksTitle') + '"><b>' + (a.total ? plural(a.total, 'accessibility issue') : 'No accessibility issues') + '</b><span>' + (a.total ? 'in ' + plural(a.comps, 'component') : 'found by automated checks') + '</span></a>' + (a.total ? '<div>' + sevList(a.counts, 1) + '</div>' : '') + '</li>' : '',
      '<li><b>' + (last ? ago(last).replace(/^./, (x) => x.toUpperCase()) : 'Not yet') + '</b><span>last checked, next run ' + nextNightly() + '</span></li>',
    ];
    $('ovFacts').innerHTML = facts.join('');
    $('ovMeter').innerHTML = meter(c);
    $('ovLegend').innerHTML = STATUS.filter((s) => c[s[0]] || s[0] !== 'notfigma').map((s) => '<li><i class="s-' + s[0] + '"></i>' + s[1] + ' <b>' + c[s[0]] + '</b></li>').join('');
    $('ovMark').innerHTML = regMark(score, !settled) + '<figcaption><i class="k-d"></i>Figma <i class="k-c"></i>Storybook</figcaption>';
    settled = true;
  }

  function a11yLine(e) {
    const a = e.a11y;
    if (!a || !a.ran) return '';
    if (!a.total) return '<p class="a11y-line clear">' + SHIELD + '<span class="t">No accessibility issues found<small>' + (a.scans ? plural(a.scans, 'automated scan') : 'Figma contrast checked') + ' across every brand</small></span></p>';
    const top = a.top && a.top[0];
    return '<p class="a11y-line">' + SHIELD + '<span class="t"><a href="' + esc(e.id) + '/#accessibility">' + plural(a.total, 'accessibility issue') + '</a>' + (top ? '<small>Worst: ' + esc(top.title) + '</small>' : '') + '</span><span class="sevs">' + sevList(a.counts, 2) + '</span></p>';
  }

  // Masonry: each card spans as many 4px rows as its height needs, so short cards don't leave gaps.
  // The cards stay in DOM order (worst first), so keyboard and screen reader order matches the sort.
  const ROW = 4, GAP = 20;
  let masonryFrame = 0;
  const sizeWatch = 'ResizeObserver' in window ? new ResizeObserver(() => { cancelAnimationFrame(masonryFrame); masonryFrame = requestAnimationFrame(layoutMasonry); }) : null;
  function layoutMasonry() {
    $('grid').querySelectorAll('.grid').forEach((grid) => {
      const oneCol = getComputedStyle(grid).gridTemplateColumns.split(' ').length < 2;
      grid.classList.toggle('masonry', !oneCol);
      for (const el of grid.children) el.style.gridRowEnd = oneCol ? '' : 'span ' + Math.ceil((el.getBoundingClientRect().height + GAP) / ROW);
    });
  }
  function masonry() {
    if (sizeWatch) { sizeWatch.disconnect(); sizeWatch.observe($('grid')); $('grid').querySelectorAll('.grid > *').forEach((el) => sizeWatch.observe(el)); }
    layoutMasonry();
  }
  // Group checks the way the Figma library groups its pages (CORE COMPONENTS, IMAGES, OTHER), in Figma's order
  const sentence = (s) => { const t = String(s || '').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
  function figmaGroups(es) {
    const groups = new Map();
    es.forEach((e) => {
      const g = e.place && e.place.group ? e.place.group : null;
      const k = g || '~other';
      if (!groups.has(k)) groups.set(k, { key: k, label: g ? sentence(g) : 'Other checks', order: Infinity, items: [] });
      const grp = groups.get(k); grp.items.push(e);
      if (e.place && e.place.order != null) grp.order = Math.min(grp.order, e.place.order);
    });
    const byOrder = (a, b) => ((a.place && a.place.order != null ? a.place.order : 1e9) - (b.place && b.place.order != null ? b.place.order : 1e9)) || String(a.name || a.id).localeCompare(String(b.name || b.id));
    return [...groups.values()].sort((a, b) => a.order - b.order).map((g) => Object.assign(g, { items: g.items.sort(byOrder) }));
  }

  const openMenus = new Set(); const confirming = new Set(); const cardErrors = new Map();
  function renderChecks() {
    const es = (status.entries || []).slice();
    $('count').textContent = es.length ? es.length : '';
    $('runAll').hidden = es.length < 2;
    const running = new Map(runs.filter((r) => r.state === 'waiting' || r.state === 'running' || r.state === 'publishing').map((r) => [r.checkId, r]));
    if (!es.length) { $('grid').innerHTML = '<div class="empty-state"><b>No checks yet</b>Paste a Figma page and its Storybook above to run the first one.</div>'; return; }
    // Figma groups with several checks get a heading; one-check groups are named by their card, so they share one grid
    const all = figmaGroups(es);
    const multi = all.filter((g) => g.items.length > 1), singles = all.filter((g) => g.items.length === 1);
    const groups = multi.length ? multi.concat(singles.length ? [{ key: '~rest', label: 'Other sections', order: Infinity, items: [].concat(...singles.map((g) => g.items)) }] : []) : [{ key: '~all', items: es }];
    const plain = groups.length === 1;
    $('grid').innerHTML = groups.map((g, gi) => (plain ? '<div class="group">' : '<section class="group" aria-labelledby="grp-' + gi + '"><div class="group-head"><h3 id="grp-' + gi + '">' + esc(g.label) + '</h3></div>') +
      '<div class="grid">' + g.items.map(cardHtml).join('') + '</div>' + (plain ? '</div>' : '</section>')).join('');
    masonry();
    function cardHtml(e) {
      const isRunning = running.has(e.id);
      const name = esc(e.name || e.id);
      const menu = openMenus.has(e.id) ? '<div class="menu-list" role="menu">' + (e.figmaUrl ? '<a role="menuitem" href="' + esc(e.figmaUrl) + '" target="_blank" rel="noopener">Open in Figma</a>' : '') + (e.storybookUrl ? '<a role="menuitem" href="' + esc(e.storybookUrl) + '" target="_blank" rel="noopener">Open in Storybook</a>' : '') + (e.ok ? '<a role="menuitem" href="' + esc(e.id) + '/issues.csv">Download issues for Jira (CSV)</a>' : '') + '<button role="menuitem" class="danger" data-act="remove">Remove check</button></div>' : '';
      const foot = '<div class="card-foot"><span class="when">' + (e.ranAt ? 'Checked ' + ago(e.ranAt) : 'Not run yet') + '</span>' +
        (e.ok ? '<a class="btn small" href="' + esc(e.id) + '/">Open report</a>' : '') +
        '<button class="iconbtn" data-act="run" aria-label="Run ' + name + ' again" title="Run again"' + (isRunning ? ' disabled' : '') + '>' + ICON.rerun + '</button>' +
        '<div class="menu"><button class="iconbtn" data-act="menu" aria-haspopup="menu" aria-expanded="' + openMenus.has(e.id) + '" aria-label="More for ' + name + '">' + ICON.more + '</button>' + menu + '</div></div>';
      const confirm = confirming.has(e.id) ? '<div class="confirm" role="alertdialog" aria-label="Remove ' + name + '"><p>Remove <b>' + name + '</b> and its report? Nightly runs stop too.</p><button class="btn small danger" data-act="remove-yes">Remove</button><button class="btn small ghost" data-act="remove-no">Keep</button></div>' : '';
      const tag = (isRunning ? '<div class="running-tag">' + (running.get(e.id).kind === 'remove' ? 'Removing' : 'Running now') + '</div>' : '');
      const cardErr = (cardErrors.has(e.id) ? '<p class="err" role="alert">' + esc(cardErrors.get(e.id)) + '</p>' : '') +
        (e.stale ? '<p class="stale">The last run ' + ago(e.stale.at) + " couldn't refresh this check, so it shows the previous result. " + esc(e.stale.error) + '</p>' : '');
      if (e.ok === false) {
        return '<article class="card failed" data-id="' + esc(e.id) + '"><div class="card-head"><div><h3>' + name + '</h3>' + tag + '</div></div><p class="err">Couldn’t run: ' + esc(e.error) + '</p>' + cardErr + confirm + foot + '</article>';
      }
      if (!e.ok) {
        return '<article class="card" data-id="' + esc(e.id) + '"><div class="card-head"><div><h3>' + name + '</h3>' + tag + '</div></div><p class="pending">' + (isRunning ? 'The first report is on its way.' : 'Not run yet.') + '</p>' + cardErr + confirm + foot + '</article>';
      }
      const k = countsOf(e.counts || {});
      const d = e.previousScore != null && e.score !== e.previousScore ? e.score - e.previousScore : null;
      const p = e.preview;
      const variant = p ? String(p.variant || '').split(',').map((x) => x.split('=').pop().trim()).join(', ') : '';
      const pair = p ? '<div class="proof"><figure class="d"><figcaption><i></i>Figma</figcaption><div class="img"><img loading="lazy" alt="' + esc(p.component) + ' in Figma" src="' + esc(p.figma) + '"></div></figure><figure class="c"><figcaption><i></i>Storybook</figcaption><div class="img"><img loading="lazy" alt="' + esc(p.component) + ' in Storybook" src="' + esc(p.code) + '"></div></figure></div>' +
        '<p class="caption">Most different: <b>' + esc(p.component) + '</b>, ' + esc(variant) + (p.brand ? ' in ' + esc(p.brand) : '') + '.' + (p.mismatch != null ? ' ' + Math.round(p.mismatch * 100) + '% of pixels differ.' : '') + '</p>'
        : '';
      const counts = STATUS.filter((s) => k[s[0]]).map((s) => '<span><i class="s-' + s[0] + '"></i>' + k[s[0]] + ' ' + s[1].toLowerCase() + '</span>').join('');
      const ignoredNote = e.ignored ? '<a class="ignored-n" href="' + esc(e.id) + '/#archive">' + e.ignored + ' archived</a>' : '';
      return '<article class="card" data-id="' + esc(e.id) + '"><div class="card-head"><div><h3><a href="' + esc(e.id) + '/">' + name + '</a></h3>' + tag + '</div>' +
        '<div class="pct" aria-label="' + e.score + '% match"><b>' + e.score + '</b><span>%</span><small>match</small>' + (d ? '<span class="delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '+' : '') + d + ' since last run</span>' : '') + '</div></div>' +
        pair + '<div class="stat">' + meter(k) + '<div class="row"><div class="counts">' + counts + ignoredNote + '</div></div></div>' + a11yLine(e) + cardErr + confirm + foot + '</article>';
    }
  }

  $('grid').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const card = b.closest('.card'); const id = card.dataset.id; const e = status.entries.find((x) => x.id === id) || {};
    const act = b.dataset.act;
    if (act === 'menu') { if (openMenus.has(id)) openMenus.delete(id); else { openMenus.clear(); openMenus.add(id); } renderChecks(); return; }
    openMenus.clear();
    cardErrors.delete(id);
    if (act === 'run') { b.disabled = true; const r = await dispatch({ check_id: id }, e.name || id, id); if (typeof r === 'string' && r !== 'later') cardErrors.set(id, "Couldn't start the check. " + r); renderChecks(); }
    if (act === 'remove') { confirming.add(id); renderChecks(); }
    if (act === 'remove-no') { confirming.delete(id); renderChecks(); }
    if (act === 'remove-yes') { b.disabled = true; b.textContent = 'Removing…'; const r = await dispatch({ remove_id: id }, e.name || id, id); confirming.delete(id); if (typeof r === 'string' && r !== 'later') cardErrors.set(id, "Couldn't remove the check. " + r); renderChecks(); }
  });
  document.addEventListener('click', (ev) => { if (openMenus.size && !ev.target.closest('.menu')) { openMenus.clear(); renderChecks(); } });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && openMenus.size) { openMenus.clear(); renderChecks(); } });
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
