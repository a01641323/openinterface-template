import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyGrantToken, isGrantActive } from './grant.mjs';
import { lanIp } from './net.mjs';
import { readGrant, writeGrant, deleteGrant } from './store.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

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

// ctx: { config, baseUrl, dataDir, interfaceDir, publicKeyB64 }
export function createInterfaceServer(ctx) {
  const sseClients = new Set();
  let expiryTimer = null;

  // The offline heart: read grant.json, verify signature with the embedded
  // public key, check the clock. Anything invalid is deleted on sight.
  function currentGrant() {
    const stored = readGrant(ctx.dataDir);
    if (!stored) return null;
    const payload = verifyGrantToken(stored.token, ctx.publicKeyB64);
    if (!payload || !isGrantActive(payload)) {
      deleteGrant(ctx.dataDir);
      return null;
    }
    return payload;
  }

  function broadcast(event) {
    for (const res of sseClients) {
      try {
        res.write(`event: ${event}\ndata: {}\n\n`);
      } catch {
        sseClients.delete(res);
      }
    }
  }

  function clearExpiryTimer() {
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  }

  // setTimeout caps at 2^31-1 ms (~24.8 days); chunk longer waits.
  function scheduleExpiry(expiresAt) {
    clearExpiryTimer();
    const MAX = 2 ** 31 - 1;
    const delta = expiresAt - Date.now();
    if (delta <= 0) return onExpired();
    expiryTimer = setTimeout(() => {
      expiryTimer = null;
      if (Date.now() >= expiresAt) onExpired();
      else scheduleExpiry(expiresAt);
    }, Math.min(delta, MAX));
  }

  function onExpired() {
    clearExpiryTimer();
    deleteGrant(ctx.dataDir);
    broadcast('expired');
  }

  function sessionBody() {
    const payload = currentGrant();
    const base = { lanIp: lanIp(), port: ctx.config.port, brandName: ctx.config.brandName };
    if (!payload) return { state: 'locked', ...base };
    return { state: 'granted', name: payload.name, expiresAt: payload.expiresAt, ...base };
  }

  // The ONLY code path that touches the internet.
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
    if (!payload || !isGrantActive(payload)) {
      return json(res, 502, { ok: false, reason: 'bad_token' });
    }
    writeGrant(ctx.dataDir, { token: data.token });
    scheduleExpiry(payload.expiresAt);
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

  async function serveStatic(res, urlPath) {
    let rel = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
    if (!rel || rel === '.') rel = 'index.html';
    const full = path.join(ctx.interfaceDir, rel);
    if (!full.startsWith(ctx.interfaceDir + path.sep)) {
      return json(res, 404, { error: 'not found' });
    }
    try {
      const content = await readFile(full);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(full)] ?? 'application/octet-stream',
      });
      res.end(content);
    } catch {
      json(res, 404, { error: 'not found' });
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      if (url.pathname === '/api/local/session' && req.method === 'GET') {
        return json(res, 200, sessionBody());
      }
      if (url.pathname === '/api/local/validate' && req.method === 'POST') {
        return await handleValidate(req, res);
      }
      if (url.pathname === '/api/local/events' && req.method === 'GET') {
        return handleEvents(req, res);
      }
      if (req.method === 'GET') return await serveStatic(res, url.pathname);
      json(res, 405, { error: 'method not allowed' });
    } catch {
      json(res, 500, { error: 'internal error' });
    }
  });

  // Restore the session across restarts: if a valid grant exists, re-arm the
  // expiry timer so the background check still fires exactly at expiresAt.
  const existing = currentGrant();
  if (existing) scheduleExpiry(existing.expiresAt);

  server.on('close', clearExpiryTimer);
  return server;
}
