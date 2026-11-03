import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVtt } from '../src/vtt.mjs';
import { createFakeAuditor } from '../src/fake-auditor.mjs';

test('parseVtt reads cues, ids, tags, short stamps and SRT commas', () => {
  const cues = parseVtt('﻿WEBVTT\n\nintro\n00:01.000 --> 00:02.500 align:start\n<v Pastor>Hei <b>kaikki</b>\nmaailma\n\n1\n00:00:03,000 --> 00:00:04,000\nToinen\n\nbad --> x\nno\n');
  assert.deepEqual(cues, [
    { start: 1, end: 2.5, text: 'Hei kaikki maailma' },
    { start: 3, end: 4, text: 'Toinen' },
  ]);
});

async function readEvents(url, until) {
  const res = await fetch(url);
  const events = [];
  let buf = '';
  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString('utf8');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /event: (.+)/.exec(block)?.[1]; const data = /data: (.+)/.exec(block)?.[1];
      if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
    }
    if (until(events)) break;
  }
  return events;
}

test('fake auditor: session replays cues as transcript events with wall times, then ends', async (t) => {
  const cues = parseVtt('WEBVTT\n\n00:00.000 --> 00:00.500\nYksi\n\n00:00.600 --> 00:01.000\nKaksi\n');
  const fake = createFakeAuditor({ cues, speed: 20, language: 'fi' });
  const { port } = await fake.listen(0);
  t.after(() => fake.close());
  const base = `http://127.0.0.1:${port}`;
  const start = await fetch(`${base}/v1/live`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'rtsp://x/y', client_ref: 'pivoice-main' }) });
  assert.equal(start.status, 202);
  const { id } = await start.json();
  const events = await readEvents(`${base}/v1/live/${id}/events`, (e) => e.some((x) => x.event === 'status' && x.data.state === 'ended'));
  const tr = events.filter((e) => e.event === 'transcript').map((e) => e.data);
  assert.deepEqual(tr.map((x) => x.text), ['Yksi', 'Kaksi']);
  assert.deepEqual(tr.map((x) => x.sequence), [1, 2]);
  assert.match(tr[0].wall_start, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.ok(Date.parse(tr[1].wall_start) > Date.parse(tr[0].wall_start));
  assert.equal(tr[0].language, 'fi');
  // Last-Event-ID resumes: only sequence 2 is replayed.
  const res = await fetch(`${base}/v1/live/${id}/events`, { headers: { 'last-event-id': '1' } });
  const text = await res.text();
  assert.ok(text.includes('Kaksi') && !text.includes('Yksi'));
});

test('fake auditor: DELETE stops, unknown session 404, api key enforced', async (t) => {
  const fake = createFakeAuditor({ cues: parseVtt('WEBVTT\n\n00:00.000 --> 00:30.000\nPitkä'), speed: 1, apiKey: 'k' });
  const { port } = await fake.listen(0);
  t.after(() => fake.close());
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/v1/live`)).status, 401);
  const auth = { authorization: 'Bearer k', 'content-type': 'application/json' };
  const { id } = await (await fetch(`${base}/v1/live`, { method: 'POST', headers: auth, body: '{}' })).json();
  assert.equal((await fetch(`${base}/v1/live/${id}`, { method: 'DELETE', headers: auth })).status, 200);
  assert.equal((await (await fetch(`${base}/v1/live/${id}`, { headers: auth })).json()).state, 'ended');
  assert.equal((await fetch(`${base}/v1/live/nope`, { headers: auth })).status, 404);
});

test('fake auditor: push delivery posts batches to a local receiver only', async (t) => {
  const got = [];
  const fake = createFakeAuditor({ cues: parseVtt('WEBVTT\n\n00:00.000 --> 00:00.200\nPush'), speed: 20, fetchFn: async (u, init) => { got.push([u, JSON.parse(init.body), init.headers.authorization]); return new Response('', { status: 202 }); } });
  const { port } = await fake.listen(0);
  t.after(() => fake.close());
  const base = `http://127.0.0.1:${port}`;
  const post = (url) => fetch(`${base}/v1/live`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delivery: { mode: 'push', url, token: 'tok' } }) });
  await post('http://127.0.0.1:3100/api/v1/transcripts');
  await post('http://192.168.1.78:3100/api/v1/transcripts');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(got.length, 1);
  assert.equal(got[0][0], 'http://127.0.0.1:3100/api/v1/transcripts');
  assert.equal(got[0][1].events[0].text, 'Push');
  assert.equal(got[0][2], 'Bearer tok');
});
