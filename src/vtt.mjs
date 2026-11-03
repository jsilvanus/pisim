// Minimal WebVTT / SRT reader: returns [{ start, end, text }] in seconds. Cue settings and tags are dropped.
function toSeconds(stamp) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(stamp.trim());
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

export function parseVtt(text) {
  const cues = [];
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, rest = ''] = lines[i].split('-->');
    const start = toSeconds(a);
    const end = toSeconds(rest.trim().split(/\s+/)[0] ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    const body = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}
