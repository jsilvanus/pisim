#!/usr/bin/env node
import fs from 'node:fs/promises';
import { parseScenario } from '../src/scenario.mjs';
import { parseVtt } from '../src/vtt.mjs';
import { createFakeAuditor } from '../src/fake-auditor.mjs';
import { assertTargetsAllowed, resolveTargets, runScenario } from '../src/player.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const [cmd, file] = args;

if (cmd === 'auditor') {
  const vtt = args.find((a, i) => i > 0 && !a.startsWith('--') && !['--port', '--speed', '--lang', '--api-key'].includes(args[i - 1]));
  if (!vtt) { console.error('Usage: pisim auditor <file.vtt> [--port 8090] [--speed 1] [--loop] [--lang fi] [--api-key k]'); process.exit(1); }
  const cues = parseVtt(await fs.readFile(vtt, 'utf8'));
  if (!cues.length) { console.error('no cues found in ' + vtt); process.exit(1); }
  const fake = createFakeAuditor({ cues, speed: Number(opt('--speed', 1)) || 1, loop: flag('--loop'), language: opt('--lang', 'fi'), apiKey: opt('--api-key'), log: (m) => console.log(m) });
  const addr = await fake.listen(Number(opt('--port', 8090)), opt('--host', '127.0.0.1'));
  console.log(`pisim auditor on http://${addr.address}:${addr.port} replaying ${cues.length} cues from ${vtt}`);
  process.on('SIGINT', async () => { await fake.close(); process.exit(0); });
} else if (cmd !== 'run' || !file) {
  console.log(`pisim - scenario player for the Pi ecosystem

  pisim run <scenario.jsonl> [--no-timing] [--out <dir>] [--allow-remote]
  pisim auditor <file.vtt> [--port 8090] [--speed 1] [--loop] [--lang fi] [--api-key k]
      Fake liturgos-auditor live API: replays the cues of a VTT as transcript events.

Targets default to the ecosystem's local ports; override with PISIM_TARGET_<NAME>=http://host:port.
Steps with "save" write the response body (e.g. a /gui page) to the out directory.`);
  process.exit(cmd ? 1 : 0);
}

if (cmd === 'run' && file) {
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

}
