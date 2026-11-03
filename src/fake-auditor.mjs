import http from 'node:http';
import { randomUUID } from 'node:crypto';

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/**
 * Stand-in for liturgos-auditor's live-session API (docs/live-sessions.md there): POST /v1/live starts a
 * session that replays the cues of a VTT file as `transcript` events at their times; GET /v1/live/{id}/events
 * is the SSE stream pivoice and pigateway follow; push delivery (`delivery.mode = "push"`) is honoured for
 * local receivers. Nothing is transcribed: the source URL in the request is ignored.
 * Clients do not know it is not the real service.
 */
export function createFakeAuditor({ cues, speed = 1, loop = false, language = 'fi', apiKey, now = Date.now, fetchFn = fetch, log = () => {} } = {}) {
  const sessions = new Map();

  function emit(session, event, data, id) {
    const frame = `${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    session.history.push(frame);
    if (session.history.length > 500) session.history.shift();
    for (const res of session.clients) res.write(frame);
  }

  function startSession(body) {
    const id = randomUUID();
    const t0 = now();
    const session = {
      id, createdAt: new Date(t0).toISOString(), clientRef: body.client_ref ?? null, language: body.language ?? language,
      delay: Number(body.delay_seconds ?? 0) || 0, state: 'running', clients: new Set(), history: [], timers: new Set(), sequence: 0,
      delivery: body.delivery?.mode === 'push' ? body.delivery : null,
    };
    sessions.set(id, session);
    emit(session, 'status', { state: 'starting' });
    emit(session, 'status', { state: 'running' });
    const total = cues.length ? cues[cues.length - 1].end : 0;
    const schedule = (offset) => {
      cues.forEach((cue) => {
        const releaseAt = (offset + cue.end + session.delay) / speed * 1000;
        const timer = setTimeout(() => {
          session.timers.delete(timer);
          if (session.state !== 'running') return;
          const wall = (s) => new Date(t0 + (offset + s) / speed * 1000).toISOString();
          const seq = ++session.sequence;
          const event = { sequence: seq, text: cue.text, language: session.language, start: offset + cue.start, end: offset + cue.end, wall_start: wall(cue.start), wall_end: wall(cue.end), delay_seconds: session.delay };
          emit(session, 'transcript', event, seq);
          push(session, event);
        }, releaseAt - (now() - t0));
        session.timers.add(timer);
      });
      const endTimer = setTimeout(() => {
        session.timers.delete(endTimer);
        if (session.state !== 'running') return;
        if (loop) return schedule(offset + total + 1);
        stop(session, 'stopped');
      }, (offset + total + session.delay) / speed * 1000 + 50);
      session.timers.add(endTimer);
    };
    schedule(0);
    return session;
  }

  async function push(session, event) {
    const d = session.delivery;
    if (!d?.url) return;
    try {
      if (!LOCAL.test(new URL(d.url).hostname)) throw new Error('push target is not local');
      await fetchFn(d.url, { method: 'POST', headers: { 'content-type': 'application/json', ...(d.token ? { authorization: `Bearer ${d.token}` } : {}) }, body: JSON.stringify({ session_id: session.id, events: [event] }) });
    } catch (e) {
      log(`push failed: ${e.message}`);
    }
  }

  function stop(session, reason) {
    if (session.state === 'ended') return;
    session.state = 'ended';
    for (const t of session.timers) clearTimeout(t);
    session.timers.clear();
    emit(session, 'status', { state: 'ended', reason });
    for (const res of session.clients) res.end();
    session.clients.clear();
  }

  const view = (s) => ({ id: s.id, state: s.state, source: 'simulated', language: s.language, client_ref: s.clientRef, created_at: s.createdAt, sequence: s.sequence });

  async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const type = req.headers['content-type'] ?? '';
    if (type.includes('multipart/form-data')) {
      // pivoice sends metadata + a binary pre-roll; only the JSON metadata field matters here.
      const m = /name="metadata"\r?\n(?:[^\r\n]+\r?\n)*\r?\n(\{[\s\S]*?\})\r?\n--/.exec(raw);
      try { return m ? JSON.parse(m[1]) : {}; } catch { return {}; }
    }
    try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  }

  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (apiKey && req.headers.authorization !== `Bearer ${apiKey}` && url.pathname !== '/health') return json(res, 401, { error: 'unauthorized' });
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (url.pathname === '/health') return json(res, 200, { status: 'ok', service: 'pisim-auditor' });
      if (url.pathname === '/status') return json(res, 200, { live: { active: [...sessions.values()].filter((s) => s.state === 'running').length }, simulated: true });
      if (parts[0] === 'v1' && parts[1] === 'live') {
        if (parts.length === 2 && req.method === 'POST') { const s = startSession(await readBody(req)); log(`session ${s.id} started`); return json(res, 202, view(s)); }
        if (parts.length === 2 && req.method === 'GET') return json(res, 200, { sessions: [...sessions.values()].map(view) });
        const session = sessions.get(parts[2]);
        if (!session) return json(res, 404, { error: 'unknown session' });
        if (parts.length === 3 && req.method === 'GET') return json(res, 200, view(session));
        if (parts.length === 3 && req.method === 'DELETE') { stop(session, 'stopped'); return json(res, 200, view(session)); }
        if (parts[3] === 'events' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
          const last = Number(req.headers['last-event-id']);
          const replay = Number.isFinite(last) ? session.history.filter((f) => { const m = /^id: (\d+)/.exec(f); return !m || Number(m[1]) > last; }) : session.history;
          for (const f of replay) res.write(f);
          if (session.state === 'ended') return res.end();
          session.clients.add(res);
          req.on('close', () => session.clients.delete(res));
          return;
        }
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  return {
    server,
    sessions,
    listen: (port = 8090, host = '127.0.0.1') => new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))),
    close: () => { for (const s of sessions.values()) stop(s, 'shutdown'); return new Promise((resolve) => server.close(resolve)); },
  };
}
