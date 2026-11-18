#!/usr/bin/env node
// atom-parity: compare the Atom Figma library with Storybook.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { run } from './run.js';
import { writeReport } from './report.js';
import { readJson, log } from './util.js';
import { runAll, addCheck, removeCheck, writeSite, mergeStatus } from './site.js';
import { changeIgnores, changeComments, appendLog } from './ignores.js';

const HELP = `
atom-parity: compare the Atom Figma library with Storybook

Usage
  atom-parity run-all             Run every saved check in checks.json and build the site (what CI runs)
  atom-parity add-check --name "Button" --figma-url <link> --storybook <link>
                                  Save a check (a Figma link + a Storybook link)
  atom-parity remove-check --id <id>   Remove a saved check
  atom-parity ignore              Ignore or restore issues; reads JSON from the IGNORE environment variable
  atom-parity comment             Add or delete a comment on an issue; reads JSON from the COMMENT environment variable
  atom-parity site                Rewrite the site index and status without running anything
  atom-parity run [options]       Run one check from the config, write the report
  atom-parity report [options]    Rebuild the HTML report from an existing results.json

Options
  -c, --config <file>       Config file (default: ./atom-parity.config.json)
  -s, --storybook <url>     Storybook URL (overrides config / STORYBOOK_URL)
  -u, --figma-url <link>    Figma link, read live (needs FIGMA_TOKEN)
  -f, --figma <file>        Figma snapshot from the Atom Parity Exporter plugin
      --name <text>         Name for add-check
      --checks <file>       Saved checks (default: checks.json)
      --site <dir>          Output folder for run-all (default: parity-site)
      --baselines <dir>     Previous run's site, for "what changed" (default: parity-baseline)
  -o, --out <dir>           Output folder (default: parity-report)
  -b, --baseline <file>     Previous results.json, to report what changed
      --only <names>        Comma-separated component names, e.g. "Button,Tags"
      --skip-visual         Skip pixel comparison
      --skip-a11y           Skip accessibility checks
      --report-url <url>    Public URL of the report (used in Jira CSV and CI summary)
      --fail-on <mode>      new-fail | any-fail | never (default from config: new-fail)
  -q, --quiet               Less output
  -h, --help                Show this help
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' }, storybook: { type: 'string', short: 's' }, figma: { type: 'string', short: 'f' },
      'figma-url': { type: 'string', short: 'u' }, name: { type: 'string' }, id: { type: 'string' }, action: { type: 'string' }, 'status-from': { type: 'string' }, checks: { type: 'string' }, site: { type: 'string' }, baselines: { type: 'string' },
      out: { type: 'string', short: 'o' }, baseline: { type: 'string', short: 'b' }, only: { type: 'string' },
      'skip-visual': { type: 'boolean' }, 'skip-a11y': { type: 'boolean' }, 'report-url': { type: 'string' }, 'fail-on': { type: 'string' },
      quiet: { type: 'boolean', short: 'q' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const cmd = positionals[0] ?? 'run';
  if (values.help || !['run', 'report', 'run-all', 'add-check', 'remove-check', 'ignore', 'comment', 'log', 'site', 'merge-status'].includes(cmd)) { console.log(HELP); process.exit(values.help ? 0 : 1); }
  log.quiet = !!values.quiet;
  const checksFile = path.resolve(values.checks ?? 'checks.json');

  if (cmd === 'add-check') {
    const e = addCheck(checksFile, { name: values.name, figmaUrl: values['figma-url'], storybookUrl: values.storybook });
    console.log(`Saved check "${e.name ?? e.id}" (${e.id}) to ${checksFile}`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `id=${e.id}\n`);
    return;
  }
  if (cmd === 'log') {
    const by = String(process.env.BY ?? '').trim().slice(0, 80);
    if (!by) return;
    appendLog(checksFile, { at: new Date().toISOString(), action: String(values.action ?? 'run').slice(0, 40), check: values.id || null, by, github: null, items: [] });
    console.log(`Logged: ${by} ${values.action} ${values.id ?? ''}`);
    return;
  }
  if (cmd === 'comment') {
    const r = changeComments(checksFile, process.env.COMMENT ?? '', { github: process.env.BY ? null : (process.env.GITHUB_TRIGGERING_ACTOR || process.env.GITHUB_ACTOR || null) });
    console.log(`${r.by} ${r.action === 'add' ? 'commented on' : 'deleted a comment in'} ${r.check}`);
    return;
  }
  if (cmd === 'ignore') {
    const r = changeIgnores(path.join(path.dirname(checksFile), 'ignores.json'), process.env.IGNORE ?? '', { github: process.env.BY ? null : (process.env.GITHUB_TRIGGERING_ACTOR || process.env.GITHUB_ACTOR || null) });
    console.log(`${r.by} ${r.action === 'add' ? 'ignored' : 'restored'} ${r.count} issue${r.count === 1 ? '' : 's'} in ${r.check}`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `id=${r.check}\naction=${r.action}\n`);
    return;
  }
  if (cmd === 'remove-check') {
    const ok = removeCheck(checksFile, values.id);
    console.log(ok ? `Removed check ${values.id}` : `No saved check called ${values.id}`);
    return;
  }
  if (cmd === 'merge-status') {
    const [base, fresh, out] = positionals.slice(1).map((p) => path.resolve(p));
    mergeStatus({ base, fresh, out, ids: (values.only ?? '').split(',').filter(Boolean), checksFile });
    return;
  }
  if (cmd === 'site') {
    writeSite({ checksFile, siteDir: path.resolve(values.site ?? 'parity-site'), statusFrom: values['status-from'] ? path.resolve(values['status-from']) : null });
    console.log('Site index written');
    return;
  }
  if (cmd === 'run-all') {
    const siteDir = path.resolve(values.site ?? 'parity-site');
    const entries = await runAll({
      configFile: values.config ?? (fs.existsSync('atom-parity.config.json') ? 'atom-parity.config.json' : undefined),
      checksFile, siteDir, baselineDir: path.resolve(values.baselines ?? 'parity-baseline'),
      statusFrom: values['status-from'] ? path.resolve(values['status-from']) : null,
      siteUrl: values['report-url'] ?? process.env.PARITY_REPORT_URL ?? null,
      only: values.only ? values.only.split(',').map((x) => x.trim()) : null,
    });
    console.log('\n' + entries.map((e) => (e.ok ? `${e.name}: ${e.score}%` : `${e.id}: failed (${e.error})`)).join('\n'));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, fs.readFileSync(path.join(siteDir, 'summary.md'), 'utf8'));
    const failOn = (values['fail-on'] ?? 'new-fail');
    if (entries.every((e) => !e.ok)) process.exit(1);
    if (failOn === 'new-fail' && entries.some((e) => e.newFails > 0)) process.exit(2);
    return;
  }

  const overrides = {};
  if (values.storybook) overrides.storybookUrl = values.storybook;
  if (values.figma) overrides.figmaManifest = path.resolve(values.figma);
  if (values['figma-url']) overrides.figmaUrl = values['figma-url'];
  if (values.out) overrides.outDir = path.resolve(values.out);
  if (values.baseline) overrides.baseline = path.resolve(values.baseline);
  if (values['fail-on']) overrides.failOn = values['fail-on'];
  const reportUrl = values['report-url'] ?? process.env.PARITY_REPORT_URL ?? null;

  if (cmd === 'report') {
    const outDir = overrides.outDir ?? path.resolve('parity-report');
    const results = readJson(path.join(outDir, 'results.json'));
    console.log(writeReport(results, outDir, { reportUrl }));
    return;
  }

  const cfg = loadConfig(values.config, overrides);
  const results = await run(cfg, {
    only: values.only ? values.only.split(',').map((s) => s.trim()).filter(Boolean) : null,
    skipVisual: values['skip-visual'], skipA11y: values['skip-a11y'],
  });
  const file = writeReport(results, cfg.outDir, { reportUrl });

  const s = results.summary;
  console.log(`\nAtom parity ${s.score}%  ·  ${s.headline}`);
  console.log(`Report: ${file}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, fs.readFileSync(path.join(cfg.outDir, 'summary.md'), 'utf8') + '\n');

  const newFails = results.delta?.newFails?.length ?? 0;
  if (cfg.failOn === 'any-fail' && s.checks.fail > 0) { console.error(`Failing: ${s.checks.fail} failed checks.`); process.exit(2); }
  if (cfg.failOn === 'new-fail' && newFails > 0) { console.error(`Failing: ${newFails} new failed checks since the baseline.`); process.exit(2); }
}

main().catch((e) => { console.error(`\n✖ ${e.message}`); if (process.env.DEBUG) console.error(e.stack); process.exit(1); });
