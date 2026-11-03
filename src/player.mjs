import fs from 'node:fs/promises';
import path from 'node:path';

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

export const DEFAULT_TARGETS = {
  picomposer: 'http://127.0.0.1:3460',
  pigateway: 'http://127.0.0.1:3100',
  pimatrix: 'http://127.0.0.1:3000',
  pitube: 'http://127.0.0.1:3105',
  pirundown: 'http://127.0.0.1:3400',
  pidirector: 'http://127.0.0.1:3450',
};

export function resolveTargets(env = process.env, overrides = {}) {
  const t = { ...DEFAULT_TARGETS };
  for (const [k, v] of Object.entries(env)) {
    const m = /^PISIM_TARGET_(.+)$/.exec(k);
    if (m && v) t[m[1].toLowerCase()] = v;
  }
  return { ...t, ...overrides };
}

/** A simulation must never act on real equipment: only local targets unless explicitly allowed. */
export function assertTargetsAllowed(targets, used, allowRemote = false) {
  for (const name of used) {
    const url = targets[name];
    if (!url) throw new Error(`unknown target "${name}" (set PISIM_TARGET_${name.toUpperCase()})`);
    if (!allowRemote && !LOCAL.test(new URL(url).hostname)) {
      throw new Error(`target "${name}" is ${url}, not local; pass --allow-remote to override`);
    }
  }
}

export async function runScenario(steps, { targets, outDir = 'pisim-out', timing = true, fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log } = {}) {
  const start = Date.now();
  const results = [];
  for (const [i, step] of steps.entries()) {
    if (timing) {
      const wait = step.at - (Date.now() - start);
      if (wait > 0) await sleep(wait);
    }
    const base = targets[step.target].replace(/\/+$/, '');
    const hasBody = step.body !== undefined;
    const init = {
      method: step.method ?? (hasBody ? 'POST' : 'GET'),
      headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...(step.headers ?? {}) },
      ...(hasBody ? { body: JSON.stringify(step.body) } : {}),
    };
    let status = 0, error;
    try {
      const res = await fetchFn(base + step.path, init);
      status = res.status;
      if (step.save) {
        await fs.mkdir(outDir, { recursive: true });
        await fs.writeFile(path.join(outDir, step.save), Buffer.from(await res.arrayBuffer()));
      } else {
        await res.arrayBuffer().catch(() => {});
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const label = step.label ?? `${init.method} ${step.target}${step.path}`;
    log(`#${i + 1} t=${step.at}ms ${label} -> ${error ? 'ERROR ' + error : status}`);
    results.push({ i: i + 1, label, status, error });
  }
  return results;
}
