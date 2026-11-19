// Defaults tuned to Atom (Dragonpass). Everything can be overridden in atom-parity.config.json.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  storybookUrl: null,
  figmaUrl: null,     // a Figma link: read live via the REST API (needs FIGMA_TOKEN)
  figmaFileKey: null, // used for "Open in Figma" links when the plugin can't read the file key
  figmaManifest: 'parity/figma-manifest.json',
  outDir: 'parity-report',
  baseline: null,
  viewport: { width: 375, height: 812, deviceScaleFactor: 2 },
  concurrency: 4,
  timeoutMs: 15000,
  failOn: 'new-fail', // new-fail | any-fail | never

  storybook: {
    headers: {},
    ignoreTitles: ['Getting Start*', 'Overview', 'Theme', 'Examples/*', 'Basics/Icons'],
    preferredStories: ['Usage', 'Default', 'Playground', 'Basic'],
    maxStoriesForUnmatched: 2,
  },

  brands: {
    global: null, // auto-detected (Atom uses "biz")
    map: {},      // Figma mode name → Storybook global value, e.g. { "Dragonpass": "global-app" }
    extraGlobals: { locale: 'en-US', direction: 'ltr' },
  },

  components: {
    aliases: {},  // Figma name → Storybook title or name, e.g. { "Accordion": "Collapse" } (still reported as a naming mismatch)
    rootSelectors: {}, // Figma name → CSS selector for the component root, when the heuristic picks the wrong element
  },

  props: {
    ignoreCode: ['children', 'className', 'style', 'id', 'tabIndex', 'ref', 'key', 'as', 'asChild', 'testId', 'data-testid', 'onClick'],
    statePropNames: ['state', 'states', 'interaction'],
    booleanStates: { Disabled: 'disabled', Loading: 'loading', Selected: 'selected', Checked: 'checked', Active: 'active' },
    map: {},      // { "Button": { "Size": { "arg": "size", "values": { "Regular": "middle" } } } }
  },

  tokens: {
    cssVarPrefix: '--aum-',
    stripSegments: ['components'],
    rename: {},   // { "typography/body/family": "--aum-body-font-family" }
    tolerance: { color: 3, px: 0.5 },
  },

  naming: {
    retired: { error: 'danger' },
    groupMap: {},  // Figma section → Storybook group, e.g. { "Actions": "Basics" } (only to silence a known, accepted difference)
  },

  visual: { enabled: true, maxVariantsPerComponent: 24, thresholds: { pass: 0.05, warn: 0.15 }, sizeTolerancePx: 1 },
  a11y: {
    enabled: true,
    // WCAG 2.2 level A and AA: the minimum standard. Level AAA and axe's best-practice rules are never counted.
    tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    // Disabled states are skipped: WCAG exempts inactive components from contrast, and they can't be used
    skipDisabled: true,
    designRules: ['color-contrast', 'link-in-text-block', 'target-size'],
  },
  interaction: { enabled: true, minTargetSize: 24 },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = isObj(v) && isObj(a?.[k]) ? merge(a[k], v) : v;
  return out;
}

export const FIGMA_DEFAULTS = { includePages: ['❖'], skipPages: ['archive', 'deprecated', 'playground'], privatePrefixes: ['.', '_'], pageDelayMs: 4000, imageDelayMs: 6000 };

export function loadConfig(file, overrides = {}) {
  let user = {};
  let dir = process.cwd();
  if (file) {
    const p = path.resolve(file);
    if (!fs.existsSync(p)) throw new Error(`Config not found: ${p}`);
    user = JSON.parse(fs.readFileSync(p, 'utf8'));
    dir = path.dirname(p);
  } else if (fs.existsSync('atom-parity.config.json')) {
    user = JSON.parse(fs.readFileSync('atom-parity.config.json', 'utf8'));
  }
  const cfg = merge(merge({ ...DEFAULTS, figma: FIGMA_DEFAULTS }, user), overrides);
  for (const k of ['figmaManifest', 'outDir', 'baseline']) if (cfg[k] && !path.isAbsolute(cfg[k])) cfg[k] = path.resolve(dir, cfg[k]);
  if (process.env.STORYBOOK_URL) cfg.storybookUrl = process.env.STORYBOOK_URL;
  if (process.env.FIGMA_URL) cfg.figmaUrl = process.env.FIGMA_URL;
  if (!cfg.storybookUrl) throw new Error('Set storybookUrl in atom-parity.config.json, pass --storybook, or set STORYBOOK_URL.');
  return cfg;
}
