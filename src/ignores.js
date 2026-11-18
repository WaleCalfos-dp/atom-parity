// Issues people chose to ignore. Kept in ignores.json next to checks.json, so every run and every person sees the same list.
// One entry = one check line on one component in one saved check: { check, component, key, title, componentName, reason, at }.
import fs from 'node:fs';

export function readIgnores(file) {
  if (!file || !fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).ignores ?? []; } catch { return []; }
}

function write(file, ignores) {
  fs.writeFileSync(file, JSON.stringify({ ignores }, null, 2) + '\n');
}

const same = (a, b) => a.check === b.check && a.component === b.component && a.key === b.key;

/** payload = { action: 'add' | 'remove', check, items: [{ component, key, title?, componentName? }], reason? } */
export function changeIgnores(file, payload) {
  const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!p || !['add', 'remove'].includes(p.action)) throw new Error('Ignore needs an action: add or remove');
  if (!p.check || !/^[a-z0-9-]{1,80}$/.test(p.check)) throw new Error('Ignore needs the saved check id');
  const items = (p.items ?? []).filter((i) => i && i.component && i.key).slice(0, 500);
  if (!items.length) throw new Error('Nothing to ignore');
  let list = readIgnores(file);
  const at = new Date().toISOString();
  const reason = String(p.reason ?? '').slice(0, 300);
  if (p.action === 'add') {
    for (const i of items) {
      const e = { check: p.check, component: String(i.component), key: String(i.key), title: String(i.title ?? '').slice(0, 200), componentName: String(i.componentName ?? '').slice(0, 120), reason, at };
      list = list.filter((x) => !same(x, e)).concat(e);
    }
  } else {
    list = list.filter((x) => !items.some((i) => same(x, { check: p.check, component: String(i.component), key: String(i.key) })));
  }
  write(file, list);
  return { check: p.check, action: p.action, count: items.length, total: list.length };
}

/** Marks ignored check lines on one component: status becomes 'ignored', the original is kept in `was`. */
export function markIgnored(checks, componentKey, ignores) {
  if (!ignores?.length) return checks;
  for (const ch of checks) {
    const hit = ignores.find((x) => x.component === componentKey && x.key === ch.key);
    if (hit && ch.status !== 'ignored') { ch.ignored = { reason: hit.reason || null, at: hit.at }; ch.was = ch.status; ch.status = 'ignored'; }
  }
  return checks;
}
