// Shared look for the web app and the reports. Concept: print registration. Figma is the cyan plate,
// Storybook the magenta plate; parity is how well they line up.

export const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Bricolage+Grotesque:opsz,wght@12..96,500..800&display=swap" rel="stylesheet">';

export const MARK = '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke-width="2.4"><g class="pl-d" stroke="#0098D4"><circle cx="14" cy="14" r="8"/><path d="M14 2v24M2 14h24"/></g><g class="pl-c" stroke="#E0218A"><circle cx="18" cy="18" r="8"/><path d="M18 6v24M6 18h24"/></g></g></svg>';

/** Two registration plates, offset by how far apart Figma and Storybook are. */
export function regMark(score, { size = 168, label = '' } = {}) {
  const off = Math.max(0, Math.min(100, 100 - (score ?? 0))) * 0.16;
  const plate = (cls, d) => `<g class="plate ${cls}" style="--d:${d.toFixed(2)}px"><circle cx="80" cy="80" r="46"/><circle cx="80" cy="80" r="15"/><path d="M80 14v132M14 80h132"/></g>`;
  return `<svg class="reg" viewBox="0 0 160 160" width="${size}" height="${size}" role="img" aria-label="${label || `Figma and Storybook ${score ?? 0}% in register`}">${plate('pd', -off)}${plate('pc', off)}</svg>`;
}

export const TOKENS = `
:root{
  --paper:#FFFFFF;--page:#F7F8FA;--well:#F1F3F6;--line:#E2E5EB;--line-2:#ECEEF2;
  --ink:#121620;--ink-2:#434A58;--ink-3:#5D6474;
  --plate-d:#0098D4;--plate-c:#E0218A;--d-ink:#00719F;--c-ink:#B8156E;
  --ok:#0D7A52;--ok-fill:#139A69;--warn:#9A5B00;--warn-fill:#E59A26;--bad:#B42B13;--bad-fill:#C63A1E;--none:#9AA1AD;--info:#3F6E99;
  --hatch:repeating-linear-gradient(135deg,#C9CED7 0 3px,#E4E7EC 3px 7px);
  --focus:#00719F;--shadow:0 1px 0 rgba(18,22,32,.04),0 8px 24px -12px rgba(18,22,32,.12);
  --display:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;
  --text:"Atkinson Hyperlegible Next","Atkinson Hyperlegible",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --r-s:6px;--r-m:10px;--r-l:16px;
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){:root{
  --paper:#161A22;--page:#0E1117;--well:#E9ECF1;--line:#272D39;--line-2:#1F2430;
  --ink:#EDF0F5;--ink-2:#B9C0CC;--ink-3:#8E96A5;
  --plate-d:#2DB4EC;--plate-c:#F2549F;--d-ink:#5CC6F2;--c-ink:#F47CB6;
  --ok:#41C997;--ok-fill:#2FB582;--warn:#F2B24C;--warn-fill:#E59A26;--bad:#FF7A61;--bad-fill:#E5533A;--none:#6E7686;--info:#7FB0DD;
  --hatch:repeating-linear-gradient(135deg,#3A414F 0 3px,#262C37 3px 7px);
  --focus:#5CC6F2;--shadow:0 1px 0 rgba(0,0,0,.3),0 10px 30px -14px rgba(0,0,0,.6);
}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--ink);font:400 15px/1.55 var(--text);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:var(--d-ink);text-underline-offset:2px;text-decoration-thickness:1px}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:4px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.mark{width:28px;height:28px;flex:none}
@media (prefers-color-scheme:dark){.mark .pl-d{stroke:#2DB4EC}.mark .pl-c{stroke:#F2549F}}
.reg{display:block;overflow:visible}
.reg .plate{fill:none;stroke-width:5;transform:translate(var(--d),var(--d));mix-blend-mode:multiply}
.reg .plate path{stroke-width:2.5}
.reg .pd{stroke:var(--plate-d)}.reg .pc{stroke:var(--plate-c)}
@media (prefers-color-scheme:dark){.reg .plate{mix-blend-mode:screen}}
@media (prefers-reduced-motion:no-preference){
  .reg.settle .plate{animation:settle 1.4s cubic-bezier(.2,.8,.2,1) both}
  .reg.settle .pd{--from:-34px}.reg.settle .pc{--from:34px}
  @keyframes settle{from{transform:translate(var(--from),var(--from));opacity:.2}to{transform:translate(var(--d),var(--d));opacity:1}}
}
.s-aligned{background:var(--ok-fill)}.s-drifted{background:var(--warn-fill)}.s-broken{background:var(--bad-fill)}.s-notbuilt{background:var(--hatch)}.s-notfigma{background:var(--info)}
.meter{display:flex;height:8px;border-radius:999px;overflow:hidden;background:var(--line-2);gap:2px}
.meter i{display:block;height:100%;min-width:6px}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;list-style:none;margin:12px 0 0;padding:0;font-size:13.5px;color:var(--ink-2)}
.legend li{display:flex;align-items:center;gap:7px}.legend i{width:10px;height:10px;border-radius:3px;flex:none}
.legend b{font:600 13.5px var(--text);color:var(--ink)}
.sev{display:inline-flex;align-items:center;gap:6px;font:600 12.5px/1 var(--text);padding:5px 9px 5px 7px;border-radius:999px;white-space:nowrap;border:1.5px solid currentColor}
.sev::before{content:"";width:8px;height:8px;background:currentColor;flex:none}
.sev.critical{color:#fff;background:var(--bad-fill);border-color:var(--bad-fill)}.sev.critical::before{clip-path:polygon(50% 0,100% 100%,0 100%)}
.sev.serious{color:var(--bad)}.sev.serious::before{transform:rotate(45deg) scale(.85)}
.sev.moderate{color:var(--warn)}.sev.moderate::before{border-radius:50%}
.sev.minor{color:var(--ink-3)}.sev.minor::before{border-radius:2px}
@media (prefers-color-scheme:dark){.sev.critical{color:#160806}}
`;
