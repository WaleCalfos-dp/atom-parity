/* Atom parity — the full team activity log: every run, ignore, restore and comment, with filters. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const PAGE = 100;

  // What each action is called, as a filter and in a sentence
  const KINDS = [
    { id: '', label: 'All' },
    { id: 'ignore', label: 'Ignored', match: ['ignore'] },
    { id: 'restore', label: 'Restored', match: ['restore'] },
    { id: 'comment', label: 'Comments', match: ['comment', 'delete-comment'] },
    { id: 'run', label: 'Runs and checks', match: ['run', 'run-all', 'add-check', 'remove-check'] },
  ];
  const q = new URLSearchParams(location.search);
  const state = { q: q.get('q') || '', by: q.get('by') || '', check: q.get('check') || '', kind: q.get('kind') || '', limit: PAGE };
  let log = [], names = {};

  const day = (iso) => {
    const d = new Date(iso), t = new Date(); t.setHours(0, 0, 0, 0);
    const diff = Math.round((t - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
  };
  const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const full = (iso) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'medium' });
  const checkName = (x) => x.checkName || names[x.check] || x.check || '';
  const checkLink = (x) => (x.check && names[x.check] ? '<a href="../' + encodeURIComponent(x.check) + '/">' + esc(checkName(x)) + '</a>' : esc(checkName(x)));
  const who = (x) => x.by || x.github || 'Someone';
  const haystack = (x) => [who(x), x.github, checkName(x), x.reason, x.text, ...(x.items || []).flatMap((i) => [i.componentName, i.title])].filter(Boolean).join(' ').toLowerCase();

  function sentence(x) {
    const n = (x.items || []).length;
    switch (x.action) {
      case 'run': return 'ran ' + checkLink(x);
      case 'run-all': return 'ran every check';
      case 'add-check': return 'added the check ' + checkLink(x);
      case 'remove-check': return 'removed the check ' + esc(checkName(x));
      case 'ignore': return 'ignored ' + plural(n, 'issue') + ' in ' + checkLink(x);
      case 'restore': return 'restored ' + plural(n, 'issue') + ' in ' + checkLink(x);
      case 'comment': return 'commented in ' + checkLink(x);
      case 'delete-comment': return 'deleted a comment in ' + checkLink(x);
      default: return esc(x.action) + ' ' + checkLink(x);
    }
  }

  function entry(x) {
    const items = x.items || [];
    const said = x.action === 'comment' || x.action === 'delete-comment' ? x.text : x.reason;
    const saidLabel = x.action === 'comment' ? 'Comment' : x.action === 'delete-comment' ? 'Deleted comment' : x.action === 'ignore' ? 'Reason' : 'Note';
    const gh = x.github && x.by && x.github.toLowerCase() !== String(x.by).toLowerCase() ? ' <span class="gh">@' + esc(x.github) + '</span>' : '';
    return '<li class="ev ev-' + esc(x.action) + '"><time datetime="' + esc(x.at) + '" title="' + esc(full(x.at)) + '">' + time(x.at) + '</time><span class="dot" aria-hidden="true"></span><div class="ev-body">' +
      '<p class="ev-what"><b>' + esc(who(x)) + '</b>' + gh + ' ' + sentence(x) + '</p>' +
      (said ? '<figure class="said' + (x.action === 'delete-comment' ? ' gone' : '') + '"><figcaption>' + saidLabel + '</figcaption><blockquote>' + esc(said) + '</blockquote></figure>' : '') +
      (items.length ? '<ul class="ev-items">' + items.map((i) => '<li><a href="../' + encodeURIComponent(x.check) + '/#c-' + encodeURIComponent(i.component) + '">' + esc(i.componentName || i.component) + '</a><span>' + esc(i.title || i.key) + '</span></li>').join('') + '</ul>' : '') +
      '</div></li>';
  }

  function filtered() {
    const kind = KINDS.find((k) => k.id === state.kind);
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    return log.filter((x) => (!state.by || who(x) === state.by) && (!state.check || x.check === state.check) &&
      (!kind || !kind.match || kind.match.includes(x.action)) && words.every((w) => haystack(x).includes(w)));
  }

  function syncUrl() {
    const u = new URL(location.href);
    ['q', 'by', 'check', 'kind'].forEach((k) => (state[k] ? u.searchParams.set(k, state[k]) : u.searchParams.delete(k)));
    history.replaceState(null, '', u);
  }

  function render() {
    const list = filtered();
    // Counts per kind follow the other filters, so they say what you'd get by switching
    const base = log.filter((x) => (!state.by || who(x) === state.by) && (!state.check || x.check === state.check));
    $('kinds').innerHTML = KINDS.map((k) => '<button type="button" class="chip" data-kind="' + k.id + '" aria-pressed="' + (state.kind === k.id) + '">' + k.label + ' <b>' + (k.match ? base.filter((x) => k.match.includes(x.action)).length : base.length) + '</b></button>').join('');
    const any = state.q || state.by || state.check || state.kind;
    $('count').textContent = any ? plural(list.length, 'entry') + ' match' + (list.length === 1 ? 'es' : '') : '';
    $('clear').hidden = !any; $('count').parentElement.hidden = !any;
    if (!list.length) { $('log').innerHTML = '<p class="empty">' + (log.length ? 'Nothing matches these filters.' : 'No activity yet. When someone runs a check, or ignores, restores or comments on an issue, it shows here with their name.') + '</p>'; return; }
    const shown = list.slice(0, state.limit);
    let h = '', cur = '';
    for (const x of shown) {
      const d = day(x.at);
      if (d !== cur) { h += (cur ? '</ol></section>' : '') + '<section class="day"><h2>' + esc(d) + '</h2><ol class="evs">'; cur = d; }
      h += entry(x);
    }
    h += '</ol></section>';
    if (list.length > shown.length) h += '<p class="more"><button type="button" class="btn ghost" id="more">Show ' + Math.min(PAGE, list.length - shown.length) + ' more</button><span>' + shown.length + ' of ' + list.length + '</span></p>';
    $('log').innerHTML = h;
    const m = $('more'); if (m) m.onclick = () => { state.limit += PAGE; render(); };
  }

  function fill() {
    const people = [...new Set(log.map(who))].sort((a, b) => a.localeCompare(b));
    const checks = [...new Set(log.map((x) => x.check).filter(Boolean))].sort((a, b) => checkName({ check: a }).localeCompare(checkName({ check: b })));
    $('by').innerHTML = '<option value="">Everyone</option>' + people.map((p) => '<option' + (p === state.by ? ' selected' : '') + '>' + esc(p) + '</option>').join('');
    $('check').innerHTML = '<option value="">Every check</option>' + checks.map((c) => '<option value="' + esc(c) + '"' + (c === state.check ? ' selected' : '') + '>' + esc(checkName({ check: c })) + '</option>').join('');
    $('q').value = state.q;
    const first = log.length ? log[log.length - 1].at : null;
    $('lede').textContent = log.length ? plural(log.length, 'action') + ' by ' + plural(people.length, 'person').replace('persons', 'people') + (first ? ' since ' + new Date(first).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '') + '. Newest first.' : 'Nothing has happened yet.';
  }

  const change = () => { state.limit = PAGE; syncUrl(); render(); };
  let t;
  $('q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = $('q').value.trim(); change(); }, 150); });
  $('by').addEventListener('change', () => { state.by = $('by').value; change(); });
  $('check').addEventListener('change', () => { state.check = $('check').value; change(); });
  $('kinds').addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (!b) return; state.kind = b.dataset.kind; change(); });
  $('clear').addEventListener('click', () => { Object.assign(state, { q: '', by: '', check: '', kind: '' }); fill(); change(); });

  const get = (u) => fetch(u + '?ts=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  Promise.all([get('../activity.json'), get('../checks-status.json')]).then(([a, st]) => {
    ((st && st.entries) || []).forEach((e) => { names[e.id] = e.name; });
    log = ((a && a.log) || []).slice().sort((x, y) => (x.at < y.at ? 1 : -1));
    if (!a) $('lede').textContent = "Couldn't load the activity log. Refresh the page to try again.";
    fill(); render();
  });
})();
