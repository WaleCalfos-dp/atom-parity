// Atom parity relay: lets teammates ignore, restore, comment and run checks from the site by giving their name,
// without a GitHub account. It holds the GitHub key (GH_TOKEN secret) and turns each request into a run of the
// Atom parity workflow. Every change is logged in the repository with the name given.
//
// Guardrails, since nobody signs in: requests must come from the site (ALLOWED_ORIGINS), inputs are checked and
// capped, each visitor is limited to a burst of changes a minute, and every action is reversible and logged.

const WORKFLOW = 'atom-parity.yml';
const ID = /^[a-z0-9-]{1,80}$/;
const READS = /^\/actions\/(workflows\/atom-parity\.yml\/runs|runs\/\d{1,20}(\/jobs)?)(\?[a-zA-Z0-9_=&%-]*)?$/;
const hits = new Map();

const text = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, n);
const items = (list) => (Array.isArray(list) ? list : []).slice(0, 500)
  .map((i) => ({ component: text(i?.component, 120), key: text(i?.key, 200), title: text(i?.title, 200), componentName: text(i?.componentName, 120) }))
  .filter((i) => i.component && i.key);
const isUrl = (v, hosts) => { try { const u = new URL(v); return u.protocol === 'https:' && (!hosts || hosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))); } catch { return false; } };

/** Turns a request from the site into workflow inputs, or returns an error message. */
export function inputsFor(b) {
  const name = text(b?.name, 80);
  if (!name) return { error: 'Add your name first, so the team can see who made this change.' };
  const inputs = { by: name, request_id: /^[a-z0-9]{6,20}$/.test(b?.request_id ?? '') ? b.request_id : Math.random().toString(36).slice(2, 10) };
  const check = text(b?.check, 80);
  switch (b?.action) {
    case 'run':
      if (!ID.test(check)) return { error: 'Unknown check' };
      inputs.check_id = check; break;
    case 'run-all': break;
    case 'add-check':
      if (!isUrl(b.figmaUrl, ['figma.com'])) return { error: 'That Figma link doesn\'t look right. Copy it from Figma: right-click a page, then Copy link to page.' };
      if (!isUrl(b.storybookUrl)) return { error: 'The Storybook link needs to start with https://' };
      inputs.figma_url = text(b.figmaUrl, 600); inputs.storybook_url = text(b.storybookUrl, 600);
      if (b.checkName) inputs.name = text(b.checkName, 80);
      break;
    case 'remove-check':
      if (!ID.test(check)) return { error: 'Unknown check' };
      inputs.remove_id = check; break;
    case 'ignore': case 'restore': {
      const list = items(b.items);
      if (!ID.test(check) || !list.length) return { error: 'Nothing to ' + b.action };
      inputs.ignore = JSON.stringify({ action: b.action === 'ignore' ? 'add' : 'remove', check, items: list, reason: text(b.reason, 300), by: name });
      break;
    }
    case 'comment': {
      const list = items(b.items); const body = String(b.text ?? '').replace(/\r/g, '').trim().slice(0, 2000);
      if (!ID.test(check) || !list.length) return { error: 'A comment needs the issue it is about' };
      if (!body) return { error: 'Write a comment first.' };
      inputs.comment = JSON.stringify({ action: 'add', check, id: text(b.id, 40), items: list, text: body, by: name });
      break;
    }
    case 'delete-comment':
      if (!ID.test(check) || !text(b.id, 40)) return { error: 'Unknown comment' };
      inputs.comment = JSON.stringify({ action: 'delete', check, id: text(b.id, 40), by: name });
      break;
    default: return { error: 'Unknown action' };
  }
  return { inputs };
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = { 'Access-Control-Allow-Origin': okOrigin ? origin : (allowed[0] || ''), 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true, repo: env.REPO || null, ready: !!env.GH_TOKEN });
    if (!okOrigin) return json({ error: 'This relay only accepts requests from the Atom parity site.' }, 403);
    if (!env.GH_TOKEN || !env.REPO) return json({ error: 'The relay is not set up yet: its GitHub key is missing.' }, 503);
    const gh = (path, init = {}) => fetch('https://api.github.com/repos/' + env.REPO + path, {
      ...init, headers: { Authorization: 'Bearer ' + env.GH_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'atom-parity-relay', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}) },
    });

    // Reading run progress, so the site can follow a check without each person's own GitHub key
    if (req.method === 'GET' && url.pathname === '/gh') {
      const path = url.searchParams.get('path') || '';
      if (!READS.test(path)) return json({ error: 'Not allowed' }, 403);
      const r = await gh(path);
      return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }

    if (req.method === 'POST' && url.pathname === '/action') {
      const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
      const now = Date.now();
      const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
      if (recent.length >= 20) return json({ error: 'That is a lot of changes in a minute. Wait a moment, then try again.' }, 429);
      recent.push(now); hits.set(ip, recent);
      if (hits.size > 5000) hits.clear();
      let body;
      try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
      const { inputs, error } = inputsFor(body);
      if (error) return json({ error }, 400);
      const payload = JSON.stringify({ ref: 'main', inputs });
      if (payload.length > 60000) return json({ error: 'That change is too large to send at once.' }, 413);
      const r = await gh('/actions/workflows/' + WORKFLOW + '/dispatches', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' } });
      if (r.status !== 204) return json({ error: r.status === 401 || r.status === 403 || r.status === 404 ? "The relay's GitHub key no longer works. Ask the site owner to renew it." : 'GitHub said ' + r.status + '. Try again in a minute.' }, 502);
      return json({ ok: true, request_id: inputs.request_id });
    }
    return json({ error: 'Not found' }, 404);
  },
};
