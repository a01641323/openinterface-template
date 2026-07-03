/* Host client for the local CLI server. All calls stay on this origin;
   the CLI is the only thing that ever talks to the internet (once, to
   validate — plus its background revocation poll). Realtime state (button
   colors, guest approvals) flows over the WebSocket; SSE remains the
   lifecycle channel for expiry. */

const $ = (id) => document.getElementById(id);

// Must match PALETTE in cli/lib/realtime.mjs and interface/guest.js.
const PALETTE = ['', '#ffe0e0', '#e0ffe0', '#e0e0ff', '#fff3c4', '#e0ffff'];

let session = null;
let eventSource = null;
let ws = null;
let expireTimer = null;
let pollTimer = null;
let tickTimer = null;

async function refresh() {
  let s;
  try {
    s = await (await fetch('/api/local/session')).json();
  } catch {
    return; // local server unreachable; next poll retries
  }
  session = s;
  if (s.state === 'granted') showGranted(s);
  else showLocked(s);
}

function clearTimers() {
  if (expireTimer) clearTimeout(expireTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (tickTimer) clearInterval(tickTimer);
  expireTimer = pollTimer = tickTimer = null;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}

function showLocked(s) {
  clearTimers();
  $('granted').hidden = true;
  $('locked').hidden = false;
  $('brand-locked').textContent = s.brandName || 'Enter code';
}

function applyColors(colors) {
  document.querySelectorAll('#granted .color-btn').forEach((btn, i) => {
    btn.style.backgroundColor = PALETTE[colors[i]] ?? '';
  });
}

function addJoinRequest(id, ip) {
  if (document.querySelector(`[data-request="${id}"]`)) return;
  const row = document.createElement('p');
  row.dataset.request = id;
  row.append(`Device ${ip} wants to join — `);
  const allow = document.createElement('button');
  allow.textContent = 'Allow';
  const deny = document.createElement('button');
  deny.textContent = 'Deny';
  const decide = (type) => () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, id }));
    row.remove();
  };
  allow.addEventListener('click', decide('approve'));
  deny.addEventListener('click', decide('deny'));
  row.append(allow, ' ', deny);
  $('join-requests').append(row);
}

function removeJoinRequest(id) {
  document.querySelector(`[data-request="${id}"]`)?.remove();
}

function connectRealtime() {
  ws = new WebSocket(`ws://${window.location.host}/ws`);
  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      applyColors(msg.colors);
      for (const g of msg.pending ?? []) addJoinRequest(g.id, g.ip);
    } else if (msg.type === 'colors') {
      applyColors(msg.colors);
    } else if (msg.type === 'joinRequest') {
      addJoinRequest(msg.id, msg.ip);
    } else if (msg.type === 'guestLeft') {
      removeJoinRequest(msg.id);
    } else if (msg.type === 'sessionEnded') {
      refresh();
    }
  };
  ws.onclose = () => {
    // SSE still owns lifecycle; just re-sync in case we missed something.
    setTimeout(refresh, 1000);
  };
}

function showGranted(s) {
  clearTimers();
  $('locked').hidden = true;
  $('granted').hidden = false;
  $('welcome').textContent = `Welcome ${s.name}`;
  $('lan-address').textContent = `http://${s.lanIp}:${s.port}`;
  $('join-requests').replaceChildren();

  const tick = () => {
    const ms = s.expiresAt - Date.now();
    $('remaining').textContent = ms > 0 ? `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s` : 'expired';
  };
  tick();
  tickTimer = setInterval(tick, 1000);

  connectRealtime();

  // Three ways to find out the session ended, in order of immediacy:
  // 1. SSE push from the CLI's background check at exactly expiresAt.
  eventSource = new EventSource('/api/local/events');
  eventSource.addEventListener('expired', refresh);
  // 2. Our own clock.
  expireTimer = setTimeout(refresh, Math.max(0, s.expiresAt - Date.now()) + 250);
  // 3. Slow poll, in case both of the above misfire.
  pollTimer = setInterval(refresh, 15000);
}

$('code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('code-input').value.trim();
  if (!code) return;
  $('code-submit').disabled = true;
  $('code-error').hidden = true;
  let res;
  try {
    res = await fetch('/api/local/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  } catch {
    showError('cannot reach the local server');
    $('code-submit').disabled = false;
    return;
  }
  const data = await res.json().catch(() => ({}));
  $('code-submit').disabled = false;
  if (data.ok) {
    $('code-input').value = '';
    refresh();
    return;
  }
  if (data.reason === 'expired') showError('code expired');
  else if (data.reason === 'offline') showError('internet connection required to validate a code');
  else showError('invalid code');
});

function showError(text) {
  $('code-error').textContent = text;
  $('code-error').hidden = false;
}

$('lan-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const ip = $('lan-input').value.trim();
  if (!ip) return;
  const port = session?.port || window.location.port || 80;
  window.location.href = `http://${ip}:${port}`;
});

// Button clicks go to the server; the authoritative color state comes back
// as a 'colors' broadcast (to us and every approved guest).
for (const btn of document.querySelectorAll('#granted .color-btn')) {
  btn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'cycle', button: Number(btn.dataset.button) }));
    }
  });
}

refresh();
