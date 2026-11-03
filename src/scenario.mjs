// Scenario = JSONL, one step per line ('#' lines and blanks ignored).
//   request: {"at":3000,"label":"..","target":"picomposer","method":"POST","path":"/api/v1/ingest/event","body":{...}}
//   snapshot: {"at":4000,"target":"picomposer","path":"/gui/1","save":"after-advisory.html"}
// `at` = ms from start. method defaults to POST when a body is given, else GET.
// Services do not know they are being simulated: they just receive ordinary requests.

export function parseScenario(text) {
  const steps = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    let s;
    try { s = JSON.parse(line); } catch { throw new Error(`scenario line ${i + 1}: invalid JSON`); }
    const bad = (m) => { throw new Error(`scenario line ${i + 1}: ${m}`); };
    if (!Number.isInteger(s.at) || s.at < 0) bad('`at` must be a non-negative integer (ms)');
    if (typeof s.target !== 'string' || !s.target) bad('`target` is required');
    if (typeof s.path !== 'string' || !s.path.startsWith('/')) bad('`path` must start with /');
    if (s.save !== undefined && (typeof s.save !== 'string' || /[\\/]|^\.\./.test(s.save))) bad('`save` must be a plain file name');
    steps.push(s);
  });
  return steps.sort((a, b) => a.at - b.at);
}
