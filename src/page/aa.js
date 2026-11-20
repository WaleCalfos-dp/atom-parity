// In-page WCAG 2.2 AA checks that axe-core doesn't cover. One self-contained function (page.evaluate sends its
// source to the browser, so nothing here may close over module scope); `cmd` picks the step.
//   quick      → 1.4.11 non-text contrast and 2.5.3 label in name, for the rendered variant
//   kbdStart   → marks the controls and adds focus sentinels around the story (2.1.1, 2.1.2, 2.4.7, 2.4.11)
//   kbdStep    → reads where keyboard focus is after one Tab press
//   kbdEnd     → which controls keyboard focus never reached; removes the sentinels
//   clipBase   → records text that is already clipped, so only new clipping counts
//   stress     → applies 200% text (1.4.4), WCAG text spacing (1.4.12) or a 320px layout (1.4.10), and reports clipping
//   unstress   → undoes it
export function aaPage({ cmd, arg }) {
  // The story root, not the measured component: the collector marks the component itself, which may be the button
  const root = document.querySelector('#storybook-root') || document.querySelector('#root') || document.querySelector('[data-ap-root]') || document.body;

  // ------------------------------------------------------------ colour maths
  const parse = (s) => {
    const m = String(s || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  // The colour behind an element: the nearest ancestor background, layered over white
  const behind = (el) => {
    const stack = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    return stack.reverse().reduce((acc, c) => over(c, acc), WHITE);
  };

  // ------------------------------------------------------------ which elements are controls
  const CONTROL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),[contenteditable="true"],[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=option],[role=slider],[role=spinbutton],[role=textbox],[role=combobox],[role=searchbox]';
  const FIELD = 'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image]),select,textarea,[role=textbox],[role=combobox],[role=searchbox],[role=spinbutton],[role=checkbox],[role=radio],[role=switch],[role=slider]';
  const off = (el) => el.matches('[disabled],[aria-disabled="true"],[tabindex="-1"]') || !!el.closest('fieldset[disabled]');
  const shown = (el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0;
  };
  const sel = (el) => {
    if (el.id) return '#' + el.id;
    const cls = [...el.classList].filter((c) => !/^(css|sc|jsx)-/.test(c)).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  const textOf = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
  const nameOf = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(textOf).join(' ').trim();
    return (el.getAttribute('aria-label') || '').trim();
  };
  // Custom checkboxes and radios often hide the real input and draw their own box: use the label around it
  const controls = () => {
    const seen = new Set();
    for (const el of root.querySelectorAll(CONTROL)) {
      if (off(el)) continue;
      if (shown(el)) { seen.add(el); continue; }
      if (el.matches('input[type=checkbox],input[type=radio]')) { const l = el.closest('label') || el.parentElement; if (l && shown(l) && root.contains(l)) { l.__apField = true; seen.add(l); } }
    }
    return [...seen];
  };
  const isField = (el) => el.matches(FIELD) || !!el.__apField;

  if (cmd === 'quick') {
    const nonText = []; const labels = []; let fields = 0, icons = 0, named = 0;
    for (const el of controls()) {
      const out = behind(el.parentElement || el);
      // A field needs a visible edge: its border or its fill, against what's around it (1.4.11)
      if (isField(el)) {
        // The visible edge may be on the field, a box drawn inside it, or the wrapper around it
        // Wrappers count when they hug the field (a stepper's box, an input's frame), not a whole card or list
        const fr = el.getBoundingClientRect(); const wraps = [];
        for (let n = el.parentElement, i = 0; n && n !== root && i < 3; n = n.parentElement, i++) { const r = n.getBoundingClientRect(); if (r.height <= fr.height * 1.8 + 8) wraps.push(n); else break; }
        const box = [...new Set([el, ...[...el.querySelectorAll('*')].slice(0, 8), ...wraps])].filter((n) => n && n.nodeType === 1 && root.contains(n) && shown(n));
        let best = null;
        for (const n of box) {
          const cs = getComputedStyle(n);
          const bw = Math.max(parseFloat(cs.borderTopWidth) || 0, parseFloat(cs.borderBottomWidth) || 0);
          const bc = parse(cs.borderBottomColor);
          const fill = parse(cs.backgroundColor);
          const cand = [];
          if (bw >= 1 && bc && bc.a > 0) cand.push({ part: 'border', c: over(bc, out) });
          if (fill && fill.a > 0) cand.push({ part: 'fill', c: over(fill, out) });
          for (const x of cand) { const r = ratio(x.c, out); if (!best || r > best.ratio) best = { ratio: r, fg: hex(x.c), bg: hex(out), part: x.part, target: sel(n) }; }
        }
        fields++;
        if (!best || best.ratio < 3) nonText.push(Object.assign({ kind: 'field', required: 3, target: sel(el) }, best || { ratio: 1, fg: hex(out), bg: hex(out), part: 'none' }));
      } else if (!textOf(el)) {
        // An icon-only control: the icon is what tells people what it is (1.4.11)
        const g = el.querySelector('svg, img, [class*=icon], [class*=Icon]');
        if (g && shown(g)) {
          icons++;
          const cs = getComputedStyle(g.tagName.toLowerCase() === 'svg' ? (g.querySelector('path,circle,rect,line,polyline,polygon') || g) : g);
          let c = parse(cs.fill && cs.fill !== 'none' ? cs.fill : '') || parse(cs.stroke && cs.stroke !== 'none' ? cs.stroke : '') || parse(cs.color);
          if (g.tagName.toLowerCase() === 'img') c = null; // can't read pixels of an image here
          if (c && c.a > 0) {
            const bg = behind(g.parentElement || el);
            const r = ratio(over(c, bg), bg);
            if (r < 3) nonText.push({ kind: 'icon', ratio: r, required: 3, fg: hex(over(c, bg)), bg: hex(bg), part: 'icon', target: sel(el) });
          }
        }
      }
      // The spoken name must contain the visible label (2.5.3)
      const vis = textOf(el); const nm = nameOf(el);
      if (vis && nm) {
        named++;
        const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
        if (!norm(nm).includes(norm(vis))) labels.push({ visible: vis.slice(0, 60), name: nm.slice(0, 60), target: sel(el) });
      }
    }
    return { nonText, labels, counts: { fields, icons, named } };
  }

  // ------------------------------------------------------------ keyboard walk
  const RING = ['outline-style', 'outline-width', 'outline-color', 'box-shadow', 'border-top-color', 'border-bottom-color', 'border-top-width', 'background-color', 'color', 'text-decoration-line'];
  const look = (el) => {
    const o = {};
    if (!el) return o;
    const cs = getComputedStyle(el);
    RING.forEach((k) => { o[k] = cs.getPropertyValue(k); });
    for (const p of ['::before', '::after']) { const s = getComputedStyle(el, p); o[p] = [s.content, s.outlineStyle, s.outlineWidth, s.borderTopColor, s.borderTopWidth, s.boxShadow, s.backgroundColor, s.opacity].join('|'); }
    return o;
  };
  const differs = (a, b) => Object.keys(a).some((k) => a[k] !== b[k]);

  if (cmd === 'kbdStart') {
    document.querySelectorAll('[data-ap-sentinel]').forEach((n) => n.remove());
    const list = controls();
    // Elements that look clickable (pointer cursor) but aren't controls: keyboard users may not reach them
    const pointer = [...root.querySelectorAll('*')].filter((el) => !el.matches(CONTROL) && !el.closest(CONTROL) && shown(el) && getComputedStyle(el).cursor === 'pointer' && (!el.parentElement || getComputedStyle(el.parentElement).cursor !== 'pointer') && !el.querySelector(CONTROL));
    window.__apK = { rest: [], items: [] };
    [...list.map((el) => ({ el, pointerOnly: false })), ...pointer.map((el) => ({ el, pointerOnly: true }))].forEach((x, i) => {
      x.el.setAttribute('data-ap-k', String(i));
      window.__apK.items.push({ i, target: sel(x.el), text: textOf(x.el).slice(0, 40), pointerOnly: x.pointerOnly, primary: !!x.el.closest('[data-ap-target]') || !!x.el.querySelector('[data-ap-target]'), reached: false });
      window.__apK.rest.push({ self: look(x.el), parent: look(x.el.parentElement) });
    });
    const mk = (pos) => { const b = document.createElement('button'); b.setAttribute('data-ap-sentinel', pos); b.textContent = pos; b.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;'; return b; };
    document.body.prepend(mk('before')); document.body.append(mk('after'));
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    document.querySelector('[data-ap-sentinel=before]').focus();
    return { controls: list.length, pointer: pointer.length };
  }
  if (cmd === 'kbdStep') {
    const a = document.activeElement;
    if (!a || a === document.body) return { where: 'none' };
    if (a.matches('[data-ap-sentinel=after]')) return { where: 'after' };
    if (a.matches('[data-ap-sentinel=before]')) return { where: 'before' };
    if (!root.contains(a)) return { where: 'outside' };
    const k = a.closest('[data-ap-k]') || a.querySelector('[data-ap-k]');
    const idx = k ? Number(k.getAttribute('data-ap-k')) : -1;
    let visible = null, obscured = null;
    if (idx >= 0) {
      const S = window.__apK;
      S.items[idx].reached = true;
      const now = { self: look(k), parent: look(k.parentElement) };
      const ownOutline = getComputedStyle(a).outlineStyle !== 'none' && parseFloat(getComputedStyle(a).outlineWidth) > 0;
      visible = ownOutline || differs(S.rest[idx].self, now.self) || differs(S.rest[idx].parent, now.parent);
      // Focus not obscured: at least part of the focused control must be visible (2.4.11)
      const r = a.getBoundingClientRect();
      const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]]
        .filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
      if (pts.length) obscured = pts.every(([x, y]) => { const t = document.elementFromPoint(x, y); return t && !a.contains(t) && !t.contains(a) && !k.contains(t); });
      S.items[idx].visible = S.items[idx].visible || visible;
      if (obscured) S.items[idx].obscured = true;
    }
    return { where: 'inside', idx };
  }
  if (cmd === 'kbdEnd') {
    const S = window.__apK || { items: [] };
    document.querySelectorAll('[data-ap-sentinel]').forEach((n) => n.remove());
    document.querySelectorAll('[data-ap-k]').forEach((n) => n.removeAttribute('data-ap-k'));
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    return S.items;
  }

  // ------------------------------------------------------------ text that gets cut off
  const clipped = () => {
    const out = [];
    for (const el of root.querySelectorAll('*')) {
      if (!shown(el)) continue;
      const cs = getComputedStyle(el);
      const hidesX = cs.overflowX !== 'visible', hidesY = cs.overflowY !== 'visible';
      if (!hidesX && !hidesY) continue;
      const scrolls = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && (cs.overflowY === 'auto' || cs.overflowY === 'scroll');
      if (scrolls) continue; // a scrolling area keeps its content reachable
      const x = hidesX && el.scrollWidth > el.clientWidth + 1, y = hidesY && el.scrollHeight > el.clientHeight + 1;
      if ((x || y) && textOf(el)) out.push({ target: sel(el), text: textOf(el).slice(0, 50), axis: x && y ? 'both' : x ? 'width' : 'height', key: el });
    }
    return out;
  };
  if (cmd === 'clipBase') {
    window.__apClip = new Set(clipped().map((c) => c.key));
    return true;
  }
  if (cmd === 'stress') {
    const before = window.__apClip || new Set();
    if (arg === 'text') {
      // 200% text size, applied to every element so pixel-sized type grows too (1.4.4)
      window.__apText = [];
      const all = [root, ...root.querySelectorAll('*')];
      const sizes = all.map((el) => { const cs = getComputedStyle(el); return [parseFloat(cs.fontSize), cs.lineHeight]; });
      all.forEach((el, i) => {
        window.__apText.push([el, el.style.fontSize, el.style.lineHeight]);
        el.style.setProperty('font-size', sizes[i][0] * 2 + 'px', 'important');
        if (/px$/.test(sizes[i][1])) el.style.setProperty('line-height', parseFloat(sizes[i][1]) * 2 + 'px', 'important');
      });
    } else if (arg === 'spacing') {
      // The WCAG text spacing values (1.4.12)
      const s = document.createElement('style'); s.id = 'ap-spacing';
      s.textContent = '[data-ap-root] *, #storybook-root *{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important}[data-ap-root] p, #storybook-root p{margin-bottom:2em !important}';
      document.head.append(s);
    } else if (arg === 'reflow') {
      // At 320px wide (the viewport is set by the caller), the story shouldn't need sideways scrolling (1.4.10)
      window.__apW = root.style.width; root.style.width = '';
    }
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const now = clipped().filter((c) => !before.has(c.key)).map(({ key, ...c }) => c);
      const r = root.getBoundingClientRect();
      const wide = arg === 'reflow' ? Math.max(document.documentElement.scrollWidth, Math.ceil(r.right)) : 0;
      done({ clipped: now.slice(0, 5), clippedCount: now.length, overflow: arg === 'reflow' && wide > innerWidth + 1 ? { width: wide, viewport: innerWidth } : null });
    })));
  }
  if (cmd === 'unstress') {
    if (arg === 'text') (window.__apText || []).forEach(([el, fs, lh]) => { el.style.fontSize = fs; el.style.lineHeight = lh; });
    if (arg === 'spacing') document.getElementById('ap-spacing')?.remove();
    if (arg === 'reflow' && window.__apW !== undefined) root.style.width = window.__apW;
    return true;
  }
  return null;
}
