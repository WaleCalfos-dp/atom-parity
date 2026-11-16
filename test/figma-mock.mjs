// Minimal Figma Plugin API mock: enough surface to run figma-plugin/code.js unmodified.
import fs from 'node:fs';
import vm from 'node:vm';

let seq = 1;
const nid = () => `${Math.floor(seq / 1000) + 1}:${seq++}`;
const MIXED = Symbol('mixed');

class Node {
  constructor(type, name, props = {}) {
    this.id = nid(); this.type = type; this.name = name; this.parent = null; this.visible = true; this.removed = false;
    this.boundVariables = {};
    Object.assign(this, props);
    if (this.children) this.children.forEach((c) => { c.parent = this; });
  }
  findAllWithCriteria({ types }) {
    const out = [];
    const walk = (n) => { (n.children ?? []).forEach((c) => { if (types.includes(c.type)) out.push(c); walk(c); }); };
    walk(this);
    return out;
  }
  appendChild(n) { if (!this.children) this.children = []; this.children.push(n); n.parent = this; }
  remove() { this.removed = true; if (this.parent?.children) this.parent.children = this.parent.children.filter((c) => c !== this); }
}

export function buildFigma({ fileName, pages, collections, variables, renderer }) {
  const root = new Node('DOCUMENT', fileName, { children: pages });
  const varById = Object.fromEntries(variables.map((v) => [v.id, v]));
  const colById = Object.fromEntries(collections.map((c) => [c.id, c]));
  const messages = [];
  const storage = {};

  const figma = {
    mixed: MIXED,
    root,
    currentPage: pages.find((p) => p.name.includes('❖')) ?? pages[0],
    get currentUser() {
      const manifest = JSON.parse(fs.readFileSync(new URL('../figma-plugin/manifest.json', import.meta.url), 'utf8'));
      if (!(manifest.permissions ?? []).includes('currentuser')) throw new Error('in get_currentUser: "currentuser" permission not specified in manifest.json');
      return { name: 'Wale Calfos' };
    },
    fileKey: 'nKc4ep7mNdD5IqFRhNRNlW',
    showUI() {},
    ui: { postMessage: (m) => messages.push(m), onmessage: null },
    notify() {},
    closePlugin() {},
    loadAllPagesAsync: async () => {},
    getStyleByIdAsync: async () => null,
    base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    clientStorage: { getAsync: async (k) => storage[k], setAsync: async (k, v) => { storage[k] = v; } },
    variables: {
      getVariableByIdAsync: async (id) => varById[id] ?? null,
      getVariableCollectionByIdAsync: async (id) => colById[id] ?? null,
      getLocalVariableCollectionsAsync: async () => collections.filter((c) => !c.remote),
    },
    createFrame() {
      const f = new Node('FRAME', 'frame', { children: [], fills: [], explicitModes: {} });
      f.setExplicitVariableModeForCollection = (col, modeId) => { f.explicitModes[typeof col === 'string' ? col : col.id] = modeId; };
      figma.currentPage.appendChild(f);
      return f;
    },
  };
  figma.currentPage.selection = [];

  // Instances render through the supplied renderer using the parent frame's brand mode
  const attach = (n) => {
    if (n.type === 'COMPONENT') {
      n.createInstance = () => {
        const inst = new Node('INSTANCE', n.name, { main: n });
        inst.exportAsync = async ({ constraint }) => {
          const modes = inst.parent?.explicitModes ?? {};
          const col = collections.find((c) => modes[c.id]);
          const modeName = col ? col.modes.find((m) => m.modeId === modes[col.id]).name : collections[0].modes[0].name;
          return renderer(n, modeName, constraint?.value ?? 1);
        };
        inst.getMainComponentAsync = async () => n;
        return inst;
      };
    }
    if (n.type === 'INSTANCE' && n.main) n.getMainComponentAsync = async () => n.main;
    (n.children ?? []).forEach(attach);
  };
  attach(root);

  async function runPlugin(code) {
    const ctx = vm.createContext({ figma, __html__: '<html></html>', console, setTimeout, Promise, Date, Math, JSON, Object, Array, String, Number, Symbol });
    vm.runInContext(code, ctx);
    const send = async (msg) => {
      const before = messages.length;
      await figma.ui.onmessage(msg);
      return messages.slice(before);
    };
    return { send, messages };
  }
  return { figma, runPlugin };
}

// ---------------------------------------------------------------- helpers to build an Atom-like library
export const alias = (id) => ({ type: 'VARIABLE_ALIAS', id });
export const hex = (h) => { const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255; return { r: n(1), g: n(3), b: n(5), a: 1 }; };
export const solid = (h, varId) => ({ type: 'SOLID', visible: true, opacity: 1, color: hex(h), ...(varId ? { boundVariables: { color: alias(varId) } } : {}) });

export function frame(name, props, children = []) { return new Node('FRAME', name, { layoutMode: 'NONE', fills: [], strokes: [], ...props, children }); }
export function text(name, chars, props) { return new Node('TEXT', name, { characters: chars, fills: [], strokes: [], textCase: 'ORIGINAL', letterSpacing: { unit: 'PIXELS', value: 0 }, ...props }); }
export function component(name, variantProperties, props, children) {
  return new Node('COMPONENT', name, { variantProperties, fills: [], strokes: [], ...props, children });
}
export function componentSet(name, props, variants) {
  const defs = {};
  const keys = Object.keys(variants[0].variantProperties ?? {});
  keys.forEach((k) => { defs[k] = { type: 'VARIANT', defaultValue: variants[0].variantProperties[k], variantOptions: [...new Set(variants.map((v) => v.variantProperties[k]))] }; });
  return new Node('COMPONENT_SET', name, { componentPropertyDefinitions: { ...defs, ...(props.extraProps ?? {}) }, description: props.description ?? '', documentationLinks: [], key: `key-${name}`, children: variants });
}
export function page(name, children = []) { return new Node('PAGE', name, { children }); }
export { Node, MIXED };
export const readCode = (p) => fs.readFileSync(p, 'utf8');
