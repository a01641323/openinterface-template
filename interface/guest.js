/* Guest client: connecting → pending-approval → approved | denied.
   Everything is slaved to the host session over the WebSocket; if the socket
   dies for ANY reason (denied, session ended, CLI killed, network drop) we
   fall back to the code screen on our own. */

const $ = (id) => document.getElementById(id);

// Must match PALETTE in cli/lib/realtime.mjs and interface/app.js.
const PALETTE = ['', '#ffe0e0', '#e0ffe0', '#e0e0ff', '#fff3c4', '#e0ffff'];

let ws = null;
let lastMessageAt = 0;
let watchdog = null;
let view = 'loading';

function show(name, message) {
  view = name;
  for (const id of ['loading', 'buttons', 'code']) $(id).hidden = id !== name;
  if (name === 'code') {
    $('code-title').textContent = 'Enter code';
    if (message) {
      $('code-error').textContent = message;
      $('code-error').hidden = false;
    } else {
      $('code-error').hidden = true;
    }
  }
}

function applyColors(colors) {
  const buttons = document.querySelectorAll('#buttons .color-btn');
  buttons.forEach((btn, i) => {
    btn.style.backgroundColor = PALETTE[colors[i]] ?? '';
  });
}

function stopWatchdog() {
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
}

function fallbackToCode(message) {
  stopWatchdog();
  if (view !== 'code') show('code', message);
}

function connect() {
  show('loading');
  ws = new WebSocket(`ws://${window.location.host}/ws`);
  lastMessageAt = Date.now();

  // Heartbeat watchdog: the server sends {type:'ping'} every 20s. If we hear
  // nothing for 45s the link is dead even if TCP never closed.
  watchdog = setInterval(() => {
    if (Date.now() - lastMessageAt > 45000) ws.close();
  }, 5000);

  ws.onmessage = (event) => {
    lastMessageAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === 'approved') {
      show('buttons');
      applyColors(msg.colors);
    } else if (msg.type === 'colors') {
      applyColors(msg.colors);
    } else if (msg.type === 'denied') {
      fallbackToCode('access denied');
    } else if (msg.type === 'sessionEnded') {
      fallbackToCode('session ended');
    }
    // 'hello' (pending) keeps the loading view; 'ping' just feeds the watchdog.
  };
  ws.onclose = () => fallbackToCode('');
  ws.onerror = () => {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  };
}

for (const btn of document.querySelectorAll('#buttons .color-btn')) {
  btn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'cycle', button: Number(btn.dataset.button) }));
    }
  });
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
    $('code-submit').disabled = false;
    show('code', 'cannot reach the server');
    return;
  }
  const data = await res.json().catch(() => ({}));
  $('code-submit').disabled = false;
  if (data.ok) {
    // A new host session just started on this CLI; rejoin as a guest.
    window.location.reload();
    return;
  }
  if (data.reason === 'expired') show('code', 'code expired');
  else if (data.reason === 'offline') show('code', 'host has no internet connection to validate a code');
  else show('code', 'invalid code');
});

connect();
