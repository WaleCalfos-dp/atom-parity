// Unit test of the team relay: request checks and how actions map to workflow inputs.
import assert from 'node:assert/strict';
import worker, { inputsFor } from '../relay/worker.js';

const it = [{ component: 'k1', key: 'Visual|height', title: 'Height', componentName: 'Button' }];
assert.match(inputsFor({ action: 'run', check: 'actions' }).error, /name/);
assert.deepEqual(Object.keys(inputsFor({ name: 'Yana', action: 'run', check: 'actions' }).inputs).sort(), ['by', 'check_id', 'request_id']);
assert.equal(inputsFor({ name: 'Yana', action: 'run', check: '../x' }).error, 'Unknown check');
assert.equal(inputsFor({ name: 'Yana', action: 'run-all' }).inputs.by, 'Yana');
assert.match(inputsFor({ name: 'Y', action: 'add-check', figmaUrl: 'https://evil.com/x', storybookUrl: 'https://sb.dev' }).error, /Figma link/);
assert.equal(inputsFor({ name: 'Y', action: 'add-check', figmaUrl: 'https://www.figma.com/design/a/b', storybookUrl: 'https://sb.dev', checkName: 'Buttons' }).inputs.name, 'Buttons');
assert.equal(inputsFor({ name: 'Y', action: 'remove-check', check: 'actions' }).inputs.remove_id, 'actions');
const ig = JSON.parse(inputsFor({ name: ' Wale ', action: 'ignore', check: 'actions', items: it, reason: 'ok' }).inputs.ignore);
assert.deepEqual([ig.action, ig.by, ig.reason, ig.items.length], ['add', 'Wale', 'ok', 1]);
assert.equal(JSON.parse(inputsFor({ name: 'W', action: 'restore', check: 'actions', items: it }).inputs.ignore).action, 'remove');
assert.match(inputsFor({ name: 'W', action: 'comment', check: 'actions', items: it, text: '  ' }).error, /Write a comment/);
const cm = JSON.parse(inputsFor({ name: 'W', action: 'comment', check: 'actions', items: it, text: 'hi', id: 'c1' }).inputs.comment);
assert.deepEqual([cm.action, cm.text, cm.by, cm.id], ['add', 'hi', 'W', 'c1']);
assert.equal(JSON.parse(inputsFor({ name: 'W', action: 'delete-comment', check: 'actions', id: 'c1' }).inputs.comment).action, 'delete');
assert.equal(inputsFor({ name: 'W', action: 'drop-table' }).error, 'Unknown action');

// The handler: origin check, read whitelist, dispatch
const env = { REPO: 'o/r', GH_TOKEN: 't', ALLOWED_ORIGINS: 'https://walecalfos-dp.github.io' };
const calls = []; globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(url.includes('/dispatches') ? null : '{"workflow_runs":[]}', { status: url.includes('/dispatches') ? 204 : 200 }); };
const req = (path, init = {}, origin = 'https://walecalfos-dp.github.io') => worker.fetch(new Request('https://relay.dev' + path, { ...init, headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...(init.headers || {}) } }), env);
assert.equal((await req('/action', { method: 'POST', body: '{}' }, 'https://evil.com')).status, 403);
assert.equal((await req('/gh?path=' + encodeURIComponent('/contents/secrets'))).status, 403);
assert.equal((await req('/gh?path=' + encodeURIComponent('/actions/workflows/atom-parity.yml/runs?event=workflow_dispatch&per_page=20'))).status, 200);
const ok = await req('/action', { method: 'POST', body: JSON.stringify({ name: 'Yana', action: 'run', check: 'actions', request_id: 'abc12345' }) });
assert.equal(ok.status, 200);
const d = calls.find((c) => c.url.endsWith('/dispatches'));
assert.equal(d.url, 'https://api.github.com/repos/o/r/actions/workflows/atom-parity.yml/dispatches');
assert.deepEqual(JSON.parse(d.init.body).inputs, { by: 'Yana', request_id: 'abc12345', check_id: 'actions' });
const bad = await req('/action', { method: 'POST', body: JSON.stringify({ action: 'run', check: 'actions' }) });
assert.equal(bad.status, 400);
console.log('✓ relay test passed');
