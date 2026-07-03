import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyGrantToken } from './grant.mjs';
import { lanIp } from './net.mjs';
import { loadInstallKey, readState, writeState, deleteState } from './sealed-store.mjs';
import { evaluateSession, TICK_MS } from './clock-guard.mjs';
import { attachWebSocket } from './ws.mjs';
import { createRealtime } from './realtime.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const REVOCATION_POLL_MS = 45_000;
const HEARTBEAT_MS = 20_000;

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// The host is whoever reaches us over loopback — they control the machine
// running the CLI. Everyone else on the LAN is a guest.
function isLoopback(remoteAddress) {
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

function cleanIp(remoteAddress) {
  return String(remoteAddress ?? '').replace(/^::ffff:/, '');
}

// ctx: { config, baseUrl, dataDir, interfaceDir, publicKeyB64 }
export function createInterfaceServer(ctx) {
  const sseClients = new Set();
  const realtime = createRealtime();
  const installKey = loadInstallKey(ctx.dataDir);

  // In-memory session is authoritative while the process runs; disk is
  // persistence (sealed with the install key — see sealed-store.mjs).
  // session: { tokenPayload, state: {token, highWater, budgetUsedMs}, lastHr }
  let session = null;
  let wallTimer = null;
  let budgetTimer = null;
  let tickTimer = null;

  function clearSessionTimers() {
    for (const t of [wallTimer, budgetTimer]) if (t) clearTimeout(t);
    if (tickTimer) clearInterval(tickTimer);
    wallTimer = budgetTimer = tickTimer = null;
  }

  // Single exit for expiry, budget exhaustion, clock tampering, integrity
  // failure AND revocation-while-online: kill the state, tell the host
  // (SSE + WS), force every guest out. Works with zero internet.
  function endSession() {
    clearSessionTimers();
    session = null;
    deleteState(ctx.dataDir);
    broadcastSse('expired');
    realtime.endSession();
  }

  // Accumulate monotonic runtime + advance the high-water mark, persist, and
  // enforce. Runs every TICK_MS while a session is live, and once whenever a
  // timer fires (so checks never depend on the wall clock alone).
  function tick() {
    if (!session) return;
    const nowHr = process.hrtime.bigint();
    session.state.budgetUsedMs += Number((nowHr - session.lastHr) / 1_000_000n);
    session.lastHr = nowHr;
    session.state.highWater = Math.max(session.state.highWater, Date.now());
    const result = evaluateSession(session.tokenPayload, session.state);
    if (result.status !== 'active') return endSession();
    writeState(ctx.dataDir, installKey, session.state);
    return result;
  }

  function armSessionRuntime() {
    clearSessionTimers();
    const result = evaluateSession(session.tokenPayload, session.state);
    if (result.status !== 'active') return endSession();
    // Wall-clock limit (chunked: setTimeout caps at 2^31-1 ms).
    const MAX = 2 ** 31 - 1;
    const scheduleWall = () => {
      const delta = session.tokenPayload.expiresAt - Date.now();
      if (delta <= 0) return endSession();
      wallTimer = setTimeout(() => {
        wallTimer = null;
        if (!session) return;
        if (Date.now() >= session.tokenPayload.expiresAt) endSession();
        else scheduleWall();
      }, Math.min(delta, MAX));
    };
    scheduleWall();
    // Monotonic budget limit: Node timers run on the monotonic clock, so this
    // fires after remainingBudgetMs of real runtime no matter what the wall
    // clock does. tick() re-evaluates and ends the session if truly spent.
    budgetTimer = setTimeout(() => {
      budgetTimer = null;
      if (!session) return;
      if (tick()?.status === 'active') armSessionRuntime();
    }, Math.min(result.remainingBudgetMs + 250, MAX));
    tickTimer = setInterval(tick, TICK_MS);
  }

  function loadSessionFromDisk() {
    const state = readState(ctx.dataDir, installKey);
    if (!state) return false;
    const tokenPayload = verifyGrantToken(state.token, ctx.publicKeyB64);
    if (!tokenPayload || evaluateSession(tokenPayload, state).status !== 'active') {
      deleteState(ctx.dataDir);
      return false;
    }
    session = { tokenPayload, state, lastHr: process.hrtime.bigint() };
    armSessionRuntime();
    return true;
  }

  // Every read re-verifies signature + wall + high-water mark + budget.
  function activeSession() {
    if (!session && !loadSessionFromDisk()) return null;
    const result = evaluateSession(session.tokenPayload, session.state);
    if (result.status !== 'active') {
      endSession();
      return null;
    }
    return session.tokenPayload;
  }

  function broadcastSse(event) {
    for (const res of sseClients) {
      try {
        res.write(`event: ${event}\ndata: {}\n\n`);
      } catch {
        sseClients.delete(res);
      }
    }
  }

  function sessionBody() {
    const payload = activeSession();
    const base = { lanIp: lanIp(), port: ctx.config.port, brandName: ctx.config.brandName };
    if (!payload) return { state: 'locked', ...base };
    return { state: 'granted', name: payload.name, expiresAt: payload.expiresAt, ...base };
  }

  // The ONLY code path that touches the internet (plus the revocation poll,
  // which reuses the same endpoint and ignores network failures).
  async function handleValidate(req, res) {
    const body = await readBody(req);
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!code) return json(res, 400, { ok: false, reason: 'missing_code' });
    let upstream;
    try {
      upstream = await fetch(`${ctx.baseUrl}/api/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
    } catch {
      return json(res, 502, { ok: false, reason: 'offline' });
    }
    if (upstream.status === 401) {
      const data = await upstream.json().catch(() => ({}));
      return json(res, 401, { ok: false, reason: data.reason ?? 'unknown' });
    }
    if (!upstream.ok) return json(res, 502, { ok: false, reason: 'server_error' });
    const data = await upstream.json().catch(() => null);
    // Never store a token we haven't verified ourselves.
    const payload = data ? verifyGrantToken(data.token, ctx.publicKeyB64) : null;
    if (!payload || Date.now() >= payload.expiresAt) {
      return json(res, 502, { ok: false, reason: 'bad_token' });
    }
    const state = { token: data.token, highWater: Date.now(), budgetUsedMs: 0 };
    writeState(ctx.dataDir, installKey, state);
    session = { tokenPayload: payload, state, lastHr: process.hrtime.bigint() };
    armSessionRuntime();
    realtime.startSession();
    return json(res, 200, { ok: true, name: payload.name, expiresAt: payload.expiresAt });
  }

  function handleEvents(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('event: hello\ndata: {}\n\n');
    sseClients.add(res);
    const heartbeat = setInterval(() => {
      try {
        res.write(': hb\n\n');
      } catch {
        /* closed */
      }
    }, 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  }

  async function serveFile(res, relPath) {
    const full = path.join(ctx.interfaceDir, relPath);
    try {
      const content = await readFile(full);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] ?? 'application/octet-stream' });
      res.end(content);
    } catch {
      json(res, 404, { error: 'not found' });
    }
  }

  async function serveStatic(res, urlPath) {
    let rel = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
    if (!rel || rel === '.') rel = 'index.html';
    const full = path.join(ctx.interfaceDir, rel);
    if (!full.startsWith(ctx.interfaceDir + path.sep)) {
      return json(res, 404, { error: 'not found' });
    }
    return serveFile(res, rel);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const loopback = isLoopback(req.socket.remoteAddress);
    try {
      if (url.pathname === '/api/local/session' && req.method === 'GET') {
        // Guests never learn session details over HTTP; their world is the
        // WS approval flow. Remote code screens see "locked" regardless.
        if (!loopback) {
          return json(res, 200, {
            state: 'locked',
            lanIp: lanIp(),
            port: ctx.config.port,
            brandName: ctx.config.brandName,
          });
        }
        return json(res, 200, sessionBody());
      }
      if (url.pathname === '/api/local/validate' && req.method === 'POST') {
        return await handleValidate(req, res);
      }
      if (url.pathname === '/api/local/events' && req.method === 'GET') {
        return handleEvents(req, res);
      }
      if (req.method === 'GET') {
        if (!loopback) {
          // HARD RULE: without an active host grant, guests get nothing but
          // the no-session page — no scripts, no buttons markup.
          if (!activeSession()) return serveFile(res, 'no-session.html');
          if (url.pathname === '/') return serveFile(res, 'guest.html');
        }
        return await serveStatic(res, url.pathname);
      }
      json(res, 405, { error: 'method not allowed' });
    } catch {
      json(res, 500, { error: 'internal error' });
    }
  });

  attachWebSocket(server, '/ws', {
    shouldAccept(req) {
      // Guests only get a socket while a session is active; the host can
      // always connect (they just see their own code screen when locked).
      return isLoopback(req.socket.remoteAddress) || Boolean(activeSession());
    },
    onConnection(conn, req) {
      if (isLoopback(req.socket.remoteAddress)) realtime.addHost(conn);
      else realtime.addGuest(conn, cleanIp(req.socket.remoteAddress));
    },
  });

  // Revoked-while-online: re-check the code upstream while a session is
  // active. An explicit 401 ends the session immediately; network errors are
  // ignored — offline sessions run until their limits by design. This check
  // is opportunistic, never required.
  const revocationPoll = setInterval(async () => {
    const payload = activeSession();
    if (!payload) return;
    try {
      const res = await fetch(`${ctx.baseUrl}/api/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: payload.code }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) endSession();
    } catch {
      /* offline or upstream trouble — local state stays authoritative */
    }
  }, REVOCATION_POLL_MS);

  // App-level heartbeat so browser clients can detect a dead link even when
  // TCP doesn't close cleanly.
  const heartbeat = setInterval(() => realtime.pingAll(), HEARTBEAT_MS);

  // Restore the session across restarts (offline refresh/reopen contract).
  loadSessionFromDisk();

  server.on('close', () => {
    clearSessionTimers();
    clearInterval(revocationPoll);
    clearInterval(heartbeat);
  });
  return server;
}
