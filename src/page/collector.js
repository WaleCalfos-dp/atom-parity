// Runs inside the Storybook preview iframe (passed to page.evaluate).
// Must be fully self-contained: no imports, no closures over Node scope.
//
// Returns, for the rendered story:
//   - the component's root element (best match to the Figma frame size when known)
//   - computed styles for the root and its descendants
//   - for each style, the var() chain it resolves through, so we can tell
//     "uses --aum-background-interactive-action" from "hard-coded #0A2333"
export function collect(opts) {
  opts = opts || {};
  const MAX_ELEMENTS = opts.maxElements || 40;
  const TOKEN_PREFIX = opts.tokenPrefix || '--';
  const PROPS = [
    'background-color', 'color', 'border-top-color', 'border-top-width', 'border-top-style',
    'border-top-left-radius', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'column-gap', 'row-gap', 'height', 'min-height', 'width', 'font-size', 'font-weight',
    'font-family', 'line-height', 'letter-spacing', 'opacity', 'box-shadow',
    'outline-style', 'outline-width', 'outline-color', 'text-transform', 'text-decoration-line'
  ];
  // Longhand → shorthands that may hold the var() when Chrome leaves the longhand empty
  const SHORTHANDS = {
    'background-color': ['background'],
    'border-top-color': ['border-top', 'border-color', 'border'],
    'border-top-width': ['border-top', 'border-width', 'border'],
    'border-top-style': ['border-top', 'border-style', 'border'],
    'border-top-left-radius': ['border-radius'],
    'padding-top': ['padding'], 'padding-right': ['padding'], 'padding-bottom': ['padding'], 'padding-left': ['padding'],
    'column-gap': ['gap'], 'row-gap': ['gap'],
    'font-size': ['font'], 'font-weight': ['font'], 'font-family': ['font'], 'line-height': ['font'],
    'outline-style': ['outline'], 'outline-width': ['outline'], 'outline-color': ['outline']
  };
  const INHERITED = new Set(['color', 'font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing', 'text-transform']);

  // ---------------------------------------------------------- rule index (cached per page)
  function specificity(sel) {
    let s = sel.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
    s = s.replace(/:(is|not|has|matches)\(/g, ' (');
    s = s.replace(/::?[a-z-]+\([^)]*\)/gi, (m) => (m.startsWith('::') ? ' E' : ' C'));
    const ids = (s.match(/#[\w-]+/g) || []).length;
    const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+|\bC\b/g) || []).length;
    const types = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+/g, ' ').match(/(^|[\s>+~(])[a-z][\w-]*|\bE\b/gi) || []).length;
    return ids * 10000 + classes * 100 + types;
  }
  function splitSelectors(text) {
    const out = []; let depth = 0; let cur = '';
    for (const ch of text) {
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function buildIndex() {
    const rules = [];
    let order = 0;
    const walk = (list) => {
      for (const r of list) {
        if (r.selectorText !== undefined && r.style) {
          rules.push({ sels: splitSelectors(r.selectorText).map((s) => ({ s, spec: specificity(s) })), style: r.style, order: order++ });
          if (r.cssRules && r.cssRules.length) { try { walk(r.cssRules); } catch (e) { /* nested */ } }
        } else if (r.cssRules) {
          if (r.media && !window.matchMedia(r.media.mediaText).matches) continue;
          if (r.conditionText && r.constructor && r.constructor.name === 'CSSSupportsRule' && window.CSS && !CSS.supports(r.conditionText)) continue;
          try { walk(r.cssRules); } catch (e) { /* cross-origin */ }
        }
      }
    };
    let crossOrigin = 0;
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch (e) { crossOrigin++; }
    }
    return { rules, crossOrigin, sheets: document.styleSheets.length };
  }
  if (!window.__apIndex || window.__apIndex.sheets !== document.styleSheets.length || opts.rebuild) window.__apIndex = buildIndex();
  const INDEX = window.__apIndex;

  const declCache = new WeakMap();
  function declsFor(el) {
    if (declCache.has(el)) return declCache.get(el);
    const map = new Map();
    const consider = (prop, value, important, spec, order) => {
      const prev = map.get(prop);
      const rank = (important ? 1e12 : 0) + spec * 1e6 + order;
      if (!prev || rank >= prev.rank) map.set(prop, { value, rank });
    };
    for (const r of INDEX.rules) {
      let best = -1;
      for (const x of r.sels) { try { if (el.matches(x.s) && x.spec > best) best = x.spec; } catch (e) { /* invalid selector */ } }
      if (best < 0) continue;
      const st = r.style;
      for (let i = 0; i < st.length; i++) { const p = st[i]; consider(p, st.getPropertyValue(p), st.getPropertyPriority(p) === 'important', best, r.order); }
      // shorthands Chrome keeps only as pending-substitution
      ['background', 'border', 'border-top', 'border-color', 'border-width', 'border-style', 'border-radius', 'padding', 'gap', 'font', 'outline'].forEach((sh) => {
        const v = st.getPropertyValue(sh); if (v) consider(sh, v, st.getPropertyPriority(sh) === 'important', best, r.order);
      });
    }
    if (el.style) for (let i = 0; i < el.style.length; i++) { const p = el.style[i]; consider(p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p) === 'important', 1e5, 1e9); }
    declCache.set(el, map);
    return map;
  }

  function declared(el, prop) {
    const d = declsFor(el);
    const v = d.get(prop);
    if (v && v.value && v.value.trim()) return v.value.trim();
    const shs = SHORTHANDS[prop] || [];
    for (const sh of shs) { const s = d.get(sh); if (s && s.value && /var\(/.test(s.value)) return s.value.trim(); }
    return null;
  }

  function declaredInherited(el, prop) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const v = declared(n, prop); if (v) return { value: v, el: n }; }
    return null;
  }

  function firstVar(value) {
    const m = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/.exec(value || '');
    return m ? { name: m[1], fallback: m[2] ? m[2].trim() : null } : null;
  }

  // Follow var() references from the declared value to a literal.
  function chainFor(el, prop) {
    const start = INHERITED.has(prop) ? declaredInherited(el, prop) : (declared(el, prop) ? { value: declared(el, prop), el } : null);
    if (!start) return { declared: null, chain: [] };
    const chain = [];
    let value = start.value;
    let ctx = start.el;
    for (let i = 0; i < 16; i++) {
      const v = firstVar(value);
      if (!v) break;
      chain.push(v.name);
      const next = declaredInherited(ctx, v.name);
      if (next) { value = next.value; ctx = next.el; }
      else if (v.fallback) value = v.fallback;
      else break;
    }
    return { declared: start.value, chain, final: value };
  }

  // ---------------------------------------------------------- element selection
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
  };
  const hasBox = (el) => {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    return (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none' ||
      parseFloat(cs.paddingTop) + parseFloat(cs.paddingLeft) > 0 || /^(BUTTON|INPUT|SELECT|TEXTAREA|A|IMG|SVG)$/i.test(el.tagName);
  };

  const sbRoot = document.querySelector('#storybook-root') || document.querySelector('#root');
  const containers = [];
  if (sbRoot) containers.push(sbRoot);
  // Portals (dialogs, toasts, sheets) render outside the story root
  for (const c of Array.from(document.body.children)) {
    if (c === sbRoot || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(c.tagName)) continue;
    if (/storybook|sb-/.test(c.id + ' ' + c.className)) continue;
    if (isVisible(c) && c.querySelector('*')) containers.push(c);
  }

  const candidates = [];
  for (const c of containers) {
    const walker = document.createTreeWalker(c, NodeFilter.SHOW_ELEMENT);
    let n = walker.nextNode(); let count = 0;
    while (n && count < 300) { if (isVisible(n)) candidates.push(n); n = walker.nextNode(); count++; }
  }

  let root = null;
  if (opts.rootSelector) root = document.querySelector(opts.rootSelector);
  if (!root && opts.figmaSize && opts.figmaSize.width) {
    const W = opts.figmaSize.width, H = opts.figmaSize.height;
    let best = Infinity;
    candidates.slice(0, 120).forEach((el, i) => {
      if (!hasBox(el) && el.children.length !== 0) return;
      const r = el.getBoundingClientRect();
      const hugW = opts.figmaSize.sizingH === 'HUG';
      const score = Math.abs(r.height - H) * 2 + (hugW ? Math.abs(r.width - W) : Math.min(Math.abs(r.width - W), 40)) + i * 0.5;
      if (score < best) { best = score; root = el; }
    });
  }
  if (!root && candidates.length) {
    root = candidates[0];
    while (root && root.children.length === 1 && !hasBox(root)) root = root.children[0];
  }
  if (!root) return { ok: false, error: 'Story rendered nothing visible', crossOriginSheets: INDEX.crossOrigin };

  // ---------------------------------------------------------- describe
  const rootRect = root.getBoundingClientRect();
  const describe = (el, depth) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const styles = {}; const vars = {}; const literals = {};
    PROPS.forEach((p) => {
      styles[p] = cs.getPropertyValue(p);
      const c = chainFor(el, p);
      if (c.chain.length) vars[p] = c.chain;
      else if (c.declared && /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(c.declared)) literals[p] = c.declared;
    });
    let ownText = '';
    for (const n of el.childNodes) if (n.nodeType === 3) ownText += n.textContent;
    ownText = ownText.replace(/\s+/g, ' ').trim();
    return {
      tag: el.tagName.toLowerCase(), depth,
      role: el.getAttribute('role') || null,
      cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').split(/\s+/).slice(0, 8).join(' '),
      text: ownText.slice(0, 60),
      rect: { x: Math.round(r.x - rootRect.x), y: Math.round(r.y - rootRect.y), w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 },
      styles, vars, literals
    };
  };

  const elements = [];
  const queue = [[root, 0]];
  while (queue.length && elements.length < MAX_ELEMENTS) {
    const [el, d] = queue.shift();
    if (!isVisible(el)) continue;
    elements.push(describe(el, d));
    for (const c of el.children) queue.push([c, d + 1]);
  }
  const textIndex = elements.findIndex((e) => e.text);
  const tokensUsed = Array.from(new Set(elements.flatMap((e) => Object.values(e.vars).flat()).filter((n) => n.startsWith(TOKEN_PREFIX))));

  // Mark the element so Playwright can screenshot / interact with it
  document.querySelectorAll('[data-ap-root]').forEach((e) => e.removeAttribute('data-ap-root'));
  root.setAttribute('data-ap-root', '1');
  const focusable = root.matches('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"]),[role=button],[role=switch],[role=checkbox],[role=radio],[role=tab]')
    ? root : root.querySelector('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"]),[role=button],[role=switch],[role=checkbox],[role=radio],[role=tab]');
  document.querySelectorAll('[data-ap-target]').forEach((e) => e.removeAttribute('data-ap-target'));
  if (focusable) focusable.setAttribute('data-ap-target', '1');

  return {
    ok: true,
    rootTag: root.tagName.toLowerCase(),
    rootRect: { w: Math.round(rootRect.width * 100) / 100, h: Math.round(rootRect.height * 100) / 100 },
    elements, textIndex, tokensUsed,
    hasTarget: !!focusable,
    targetRect: focusable ? (() => { const r = focusable.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
    targetDisabled: focusable ? !!(focusable.disabled || focusable.getAttribute('aria-disabled') === 'true') : false,
    crossOriginSheets: INDEX.crossOrigin
  };
}

// Styles of the interaction target, used for hover/focus comparisons.
export function targetStyles() {
  const el = document.querySelector('[data-ap-target]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  const keys = ['background-color', 'color', 'border-top-color', 'border-top-width', 'box-shadow', 'outline-style', 'outline-width', 'outline-color', 'outline-offset', 'text-decoration-line', 'opacity', 'transform'];
  const out = {}; keys.forEach((k) => { out[k] = cs.getPropertyValue(k); });
  // Focus rings are often drawn with ::before/::after
  ['::before', '::after'].forEach((pseudo) => {
    const p = getComputedStyle(el, pseudo);
    out[pseudo + ' outline'] = p.getPropertyValue('outline-style') + ' ' + p.getPropertyValue('outline-width');
    out[pseudo + ' border'] = p.getPropertyValue('border-top-width') + ' ' + p.getPropertyValue('border-top-color');
    out[pseudo + ' box-shadow'] = p.getPropertyValue('box-shadow');
  });
  out.active = document.activeElement === el || el.contains(document.activeElement);
  return out;
}

// Computed value of every requested custom property, read from the element
// that carries the brand/theme context (falls back to <html>).
export function tokenValues(names) {
  const ctx = document.querySelector('[data-ap-root]') || document.querySelector('#storybook-root *') || document.documentElement;
  const cs = getComputedStyle(ctx);
  const out = {};
  names.forEach((n) => { const v = cs.getPropertyValue(n).trim(); out[n] = v || null; });
  out.__rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return out;
}

// Every custom property defined by any rule in the page (names only), for inventory.
export function definedTokens(prefix) {
  const names = new Set();
  const walk = (list) => { for (const r of list) { if (r.style) for (let i = 0; i < r.style.length; i++) if (r.style[i].startsWith(prefix)) names.add(r.style[i]); if (r.cssRules) { try { walk(r.cssRules); } catch (e) { /* skip */ } } } };
  for (const s of document.styleSheets) { try { walk(s.cssRules); } catch (e) { /* cross-origin */ } }
  return Array.from(names);
}
