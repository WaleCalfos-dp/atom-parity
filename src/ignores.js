// The team's shared notes, kept in the repository next to checks.json so every run and every person sees the same:
//   ignores.json   issues people chose to ignore (the archive):
//                  { check, component, key, title, componentName, reason, by, github, at }
//   comments.json  comments on issues: { id, check, items: [{ component, key, title, componentName }], text, by, github, at }
//   team-log.json  append-only history of ignores, restores and comments: { at, action, check, by, github, reason|text, items }
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const LOG_LIMIT = 3000;
const readJsonFile = (file, key) => { if (!file || !fs.existsSync(file)) return []; try { return JSON.parse(fs.readFileSync(file, 'utf8'))[key] ?? []; } catch { return []; } };
const logFile = (file) => path.join(path.dirname(file), 'team-log.json');
function appendLog(file, event) {
  const lf = logFile(file);
  const log = readJsonFile(lf, 'log').concat(event).slice(-LOG_LIMIT);
  fs.writeFileSync(lf, JSON.stringify({ log }, null, 2) + '\n');
}
function readFile(file) { return { ignores: readJsonFile(file, 'ignores') }; }
export const readIgnores = (file) => readJsonFile(file, 'ignores');
/** The team log; `file` is any file in the folder that holds the notes (ignores.json or checks.json). */
export const readActivity = (file) => readJsonFile(logFile(file), 'log');
export const readComments = (file) => readJsonFile(path.join(path.dirname(file), 'comments.json'), 'comments');

const same = (a, b) => a.check === b.check && a.component === b.component && a.key === b.key;
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

/**
 * payload = { action: 'add' | 'remove', check, items: [{ component, key, title?, componentName? }], reason?, by? }
 * who = { github } — the GitHub account that sent the change (the workflow's actor), recorded beside the typed name.
 */
export function changeIgnores(file, payload, who = {}) {
  const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!p || !['add', 'remove'].includes(p.action)) throw new Error('Ignore needs an action: add or remove');
  if (!p.check || !/^[a-z0-9-]{1,80}$/.test(p.check)) throw new Error('Ignore needs the saved check id');
  const items = (p.items ?? []).filter((i) => i && i.component && i.key).slice(0, 500)
    .map((i) => ({ component: clean(i.component, 120), key: clean(i.key, 200), title: clean(i.title, 200), componentName: clean(i.componentName, 120) }));
  if (!items.length) throw new Error('Nothing to ignore');
  const data = readFile(file);
  const at = new Date().toISOString();
  const reason = clean(p.reason, 300);
  const by = clean(p.by, 80) || clean(who.github, 80) || 'Someone';
  const github = clean(who.github, 80) || null;
  if (p.action === 'add') {
    for (const i of items) {
      const e = { check: p.check, ...i, reason, by, github, at };
      data.ignores = data.ignores.filter((x) => !same(x, e)).concat(e);
    }
  } else {
    data.ignores = data.ignores.filter((x) => !items.some((i) => same(x, { check: p.check, ...i })));
  }
  fs.writeFileSync(file, JSON.stringify({ ignores: data.ignores }, null, 2) + '\n');
  appendLog(file, { at, action: p.action === 'add' ? 'ignore' : 'restore', check: p.check, by, github, reason, items });
  return { check: p.check, action: p.action, count: items.length, total: data.ignores.length, by };
}

/** Marks ignored check lines on one component: status becomes 'ignored', the original is kept in `was`. */
export function markIgnored(checks, componentKey, ignores) {
  if (!ignores?.length) return checks;
  for (const ch of checks) {
    const hit = ignores.find((x) => x.component === componentKey && x.key === ch.key);
    if (hit && ch.status !== 'ignored') { ch.ignored = { reason: hit.reason || null, at: hit.at, by: hit.by ?? null, github: hit.github ?? null }; ch.was = ch.status; ch.status = 'ignored'; }
  }
  return checks;
}

/**
 * payload = { action: 'add', check, items, text, by } or { action: 'delete', check, id, by }
 * `file` is any file in the notes folder; comments go to comments.json beside it.
 */
export function changeComments(file, payload, who = {}) {
  const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!p || !['add', 'delete'].includes(p.action)) throw new Error('A comment needs an action: add or delete');
  if (!p.check || !/^[a-z0-9-]{1,80}$/.test(p.check)) throw new Error('A comment needs the saved check id');
  const cf = path.join(path.dirname(file), 'comments.json');
  let comments = readJsonFile(cf, 'comments');
  const at = new Date().toISOString();
  const by = clean(p.by, 80) || clean(who.github, 80) || 'Someone';
  const github = clean(who.github, 80) || null;
  if (p.action === 'add') {
    const items = (p.items ?? []).filter((i) => i && i.component && i.key).slice(0, 500)
      .map((i) => ({ component: clean(i.component, 120), key: clean(i.key, 200), title: clean(i.title, 200), componentName: clean(i.componentName, 120) }));
    const text = String(p.text ?? '').replace(/\r/g, '').trim().slice(0, 2000);
    if (!items.length) throw new Error('A comment needs the issue it is about');
    if (!text) throw new Error('A comment needs some text');
    const id = clean(p.id, 40) || crypto.randomUUID().slice(0, 12);
    if (comments.some((c) => c.id === id)) return { action: 'add', check: p.check, id, by, duplicate: true };
    comments.push({ id, check: p.check, items, text, by, github, at });
    fs.writeFileSync(cf, JSON.stringify({ comments }, null, 2) + '\n');
    appendLog(file, { at, action: 'comment', check: p.check, by, github, text, items, id });
    return { action: 'add', check: p.check, id, by };
  }
  const target = comments.find((c) => c.id === p.id && c.check === p.check);
  if (!target) throw new Error('That comment no longer exists');
  comments = comments.filter((c) => c !== target);
  fs.writeFileSync(cf, JSON.stringify({ comments }, null, 2) + '\n');
  appendLog(file, { at, action: 'delete-comment', check: p.check, by, github, text: target.text, items: target.items, id: target.id });
  return { action: 'delete', check: p.check, id: target.id, by };
}
