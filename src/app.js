// The web app at the root of the report site. Styles and script live in src/client and are
// copied next to index.html with a content hash in the URL, so browsers pick up new versions.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MARK, TOKENS, FONTS } from './theme.js';

const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'client');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hash = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(CLIENT, f))).digest('hex').slice(0, 10);

export { MARK };

export function writeClient(siteDir) {
  fs.writeFileSync(path.join(siteDir, 'app.css'), clientCss());
  fs.copyFileSync(path.join(CLIENT, 'app.js'), path.join(siteDir, 'app.js'));
}
const clientCss = () => TOKENS + fs.readFileSync(path.join(CLIENT, 'app.css'), 'utf8');
const cssHash = () => crypto.createHash('sha1').update(clientCss()).digest('hex').slice(0, 10);

export function appHtml({ repo }) {
  const repoName = repo ? repo.split('/')[1] : 'atom-parity';
  const tokenUrl = 'https://github.com/settings/personal-access-tokens/new';
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atom parity</title>
<meta name="description" content="How closely the Atom Design System's Storybook matches the Figma library, across every brand.">
<meta name="theme-color" content="#F7F8FA" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0E1117" media="(prefers-color-scheme: dark)">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(MARK.replace('class="mark" ', 'xmlns="http://www.w3.org/2000/svg" '))}">
${FONTS}
<link rel="stylesheet" href="app.css?v=${cssHash()}">
</head>
<body>
<a class="skip" href="#checksTitle">Skip to checks</a>
<header class="topbar"><div class="in">
  <a class="home" href="./">${MARK}<span class="brand"><b>Atom parity</b><span>Atom Design System</span></span></a>
  <span class="spacer"></span>
  <button class="conn off" id="connBtn" type="button"><i aria-hidden="true"></i><span id="connLabel">Connect GitHub</span></button>
</div></header>

<main class="wrap">
  <section class="hero" id="overview" aria-labelledby="ovTitle">
    <div class="hero-text">
      <h1 id="ovTitle">Storybook compared with Figma</h1>
      <p class="lede" id="ovLede">Loading the latest results.</p>
      <ul class="facts" id="ovFacts"></ul>
      <div class="hero-meter" id="ovMeter"></div>
      <ul class="legend" id="ovLegend"></ul>
    </div>
    <figure class="hero-mark" id="ovMark" aria-hidden="true"></figure>
  </section>

  <section class="compose" aria-labelledby="composeTitle">
    <div class="compose-head">
      <h2 id="composeTitle">New check</h2>
      <p>Paste a Figma page and the Storybook it should match. The report is ready in about 5 minutes, then reruns every weekday night.</p>
    </div>
    <form id="form" class="compose-form" novalidate>
      <div class="fld d"><label for="figma"><i aria-hidden="true"></i>Figma page</label><input id="figma" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="figma.com/design/…" aria-describedby="figmaHint"></div>
      <div class="fld c"><label for="sb"><i aria-hidden="true"></i>Storybook</label><input id="sb" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://…"></div>
      <div class="fld"><label for="name">Name <span>optional</span></label><input id="name" type="text" autocomplete="off" placeholder="Buttons"></div>
      <button class="btn" id="runBtn" type="submit">Run check</button>
    </form>
    <p class="form-err" id="formErr" role="alert"></p>
    <p class="hint" id="figmaHint">In Figma, right-click a page in the left sidebar and choose <b>Copy link to page</b>. Link to a section page, like <b>ACTIONS</b>, to check every component in it.</p>
    <div class="runs" id="runs" aria-live="polite"></div>
  </section>

  <section class="checks" aria-labelledby="checksTitle">
    <div class="sec-head">
      <h2 id="checksTitle" tabindex="-1">Checks <span id="count"></span></h2>
      <button class="btn ghost" id="runAll" type="button" hidden>Run all checks</button>
    </div>
    <div class="groups" id="grid"><div class="empty-state"><b>Loading checks</b></div></div>
  </section>
</main>

<footer class="site"><div class="in"><span>Reports are public to anyone with the link. Accessibility results come from automated checks, which find about a third of issues.</span>${repo ? `<a href="https://github.com/${esc(repo)}">Source and settings</a>` : ''}</div></footer>

<dialog id="connect" aria-labelledby="dlgTitle">
  <div class="dlg">
    <button class="x close" id="closeDlg" type="button" aria-label="Close"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg></button>
    <h2 id="dlgTitle">Connect GitHub</h2>
    <p>Checks run on GitHub, so this browser needs a key to start them. Reading reports doesn't need one.</p>
    <p class="err" id="keyErr" role="alert"></p>
    <ol>
      <li><span>Open <a href="${tokenUrl}" target="_blank" rel="noopener">GitHub's new token page</a> and name the token, for example "Atom parity".</span></li>
      <li><span>Under <b>Repository access</b>, choose <b>Only select repositories</b> and pick <b>${esc(repoName)}</b>.</span></li>
      <li><span>Under <b>Permissions</b>, add <b>Actions</b> and set it to <b>Read and write</b>. Generate the token and copy it.</span></li>
    </ol>
    <form id="keyForm" class="row">
      <div class="fld"><label for="key" class="sr">Key</label><input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste the key (github_pat_…)"></div>
      <button class="btn" id="saveKey" type="submit">Connect</button>
    </form>
    <p class="fine"><span>The key stays in this browser only.</span><button type="button" id="forget" hidden>Disconnect this browser</button></p>
  </div>
</dialog>

<script>window.ATOM_PARITY = ${JSON.stringify({ repo })};</script>
<script src="app.js?v=${hash('app.js')}"></script>
</body>
</html>`;
}
