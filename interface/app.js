/* Vanilla JS client for the local CLI server. All calls stay on this origin;
   the CLI is the only thing that ever talks to the internet (once, to validate). */

const $ = (id) => document.getElementById(id);

let session = null;
let eventSource = null;
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
}

function showLocked(s) {
  clearTimers();
  $('granted').hidden = true;
  $('locked').hidden = false;
  $('brand-locked').textContent = s.brandName || 'Enter code';
}

function showGranted(s) {
  clearTimers();
  $('locked').hidden = true;
  $('granted').hidden = false;
  $('welcome').textContent = `Welcome ${s.name}`;
  $('lan-address').textContent = `http://${s.lanIp}:${s.port}`;

  const tick = () => {
    const ms = s.expiresAt - Date.now();
    $('remaining').textContent = ms > 0 ? `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s` : 'expired';
  };
  tick();
  tickTimer = setInterval(tick, 1000);

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

for (const btn of document.querySelectorAll('.color-btn')) {
  const colors = ['', '#ffe0e0', '#e0ffe0', '#e0e0ff', '#fff3c4', '#e0ffff'];
  let i = 0;
  btn.addEventListener('click', () => {
    i = (i + 1) % colors.length;
    btn.style.backgroundColor = colors[i];
  });
}

refresh();
