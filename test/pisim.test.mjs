import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseScenario } from '../src/scenario.mjs';
import { assertTargetsAllowed, resolveTargets, runScenario } from '../src/player.mjs';

test('parseScenario skips comments, sorts, rejects bad steps', () => {
  const s = parseScenario('# c\n{"at":5,"target":"a","path":"/x"}\n\n{"at":1,"target":"a","path":"/y"}');
  assert.deepEqual(s.map((x) => x.at), [1, 5]);
  assert.throws(() => parseScenario('{"at":1,"path":"/x"}'), /target/);
  assert.throws(() => parseScenario('{"at":1,"target":"a","path":"x"}'), /path/);
  assert.throws(() => parseScenario('{"at":1,"target":"a","path":"/x","save":"../e"}'), /save/);
  assert.throws(() => parseScenario('nope'), /invalid JSON/);
});

test('sample scenarios parse', async () => {
  for (const f of await fs.readdir('scenarios')) {
    assert.ok(parseScenario(await fs.readFile(path.join('scenarios', f), 'utf8')).length > 0);
  }
});

test('targets: env override, remote refused unless allowed', () => {
  const t = resolveTargets({ PISIM_TARGET_PICOMPOSER: 'http://192.168.1.78:3460' });
  assert.throws(() => assertTargetsAllowed(t, ['picomposer']), /not local/);
  assertTargetsAllowed(t, ['picomposer'], true);
  assert.throws(() => assertTargetsAllowed(t, ['nope']), /unknown target/);
  assertTargetsAllowed(resolveTargets({}), ['picomposer']);
});

test('runScenario sends requests and saves bodies', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pisim-'));
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push([url, init.method, init.body]);
    return new Response('<html>ok</html>', { status: 200 });
  };
  const res = await runScenario(
    parseScenario('{"at":0,"target":"picomposer","path":"/e","body":{"a":1}}\n{"at":1,"target":"picomposer","path":"/gui/1","save":"g.html"}'),
    { targets: resolveTargets({}), outDir: dir, timing: false, fetchFn, log: () => {} },
  );
  assert.deepEqual(calls[0], ['http://127.0.0.1:3460/e', 'POST', '{"a":1}']);
  assert.equal(calls[1][1], 'GET');
  assert.equal(await fs.readFile(path.join(dir, 'g.html'), 'utf8'), '<html>ok</html>');
  assert.ok(res.every((r) => r.status === 200));
  await fs.rm(dir, { recursive: true });
});
