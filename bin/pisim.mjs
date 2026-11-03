#!/usr/bin/env node
import fs from 'node:fs/promises';
import { parseScenario } from '../src/scenario.mjs';
import { assertTargetsAllowed, resolveTargets, runScenario } from '../src/player.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const [cmd, file] = args;

if (cmd !== 'run' || !file) {
  console.log(`pisim - scenario player for the Pi ecosystem

  pisim run <scenario.jsonl> [--no-timing] [--out <dir>] [--allow-remote]

Targets default to the ecosystem's local ports; override with PISIM_TARGET_<NAME>=http://host:port.
Steps with "save" write the response body (e.g. a /gui page) to the out directory.`);
  process.exit(cmd ? 1 : 0);
}

try {
  const steps = parseScenario(await fs.readFile(file, 'utf8'));
  const targets = resolveTargets();
  assertTargetsAllowed(targets, new Set(steps.map((s) => s.target)), flag('--allow-remote'));
  const results = await runScenario(steps, { targets, outDir: opt('--out', 'pisim-out'), timing: !flag('--no-timing') });
  process.exit(results.some((r) => r.error || r.status >= 400) ? 2 : 0);
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
