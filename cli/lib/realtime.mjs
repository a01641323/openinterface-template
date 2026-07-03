// Guest/session state machine. Sockets are injected (anything with
// send/close/on), so this is unit-testable without real network.
//
// Guest states: connecting → pending → approved | denied(terminal, closed).
// Approvals are per-connection and in-memory only — nothing persists.
// Session slaving lives in server.mjs; this module just executes
// startSession/endSession transitions when told.

// Index 0 = default (no background). Must match the palettes in
// interface/app.js and interface/guest.js.
export const PALETTE = ['', '#ffe0e0', '#e0ffe0', '#e0e0ff', '#fff3c4', '#e0ffff'];

export function createRealtime() {
  let colors = [0, 0, 0];
  let nextGuestId = 1;
  const guests = new Map(); // id → { id, ip, state: 'pending'|'approved', conn }
  const hosts = new Set();

  function sendHosts(msg) {
    for (const conn of hosts) conn.send(msg);
  }

  function broadcastColors() {
    const msg = { type: 'colors', colors: [...colors] };
    sendHosts(msg);
    for (const g of guests.values()) if (g.state === 'approved') g.conn.send(msg);
  }

  function cycle(button) {
    if (!Number.isInteger(button) || button < 0 || button >= colors.length) return;
    colors[button] = (colors[button] + 1) % PALETTE.length;
    broadcastColors();
  }

  function approve(id) {
    const g = guests.get(id);
    if (!g || g.state !== 'pending') return;
    g.state = 'approved';
    g.conn.send({ type: 'approved', colors: [...colors] });
  }

  function deny(id) {
    const g = guests.get(id);
    if (!g || g.state !== 'pending') return;
    guests.delete(id); // delete first so the close handler doesn't echo guestLeft
    g.conn.send({ type: 'denied' });
    g.conn.close();
  }

  function addHost(conn) {
    hosts.add(conn);
    conn.send({
      type: 'hello',
      role: 'host',
      colors: [...colors],
      pending: [...guests.values()]
        .filter((g) => g.state === 'pending')
        .map((g) => ({ id: g.id, ip: g.ip })),
    });
    conn.on('message', (msg) => {
      if (msg?.type === 'cycle') cycle(msg.button);
      else if (msg?.type === 'approve') approve(msg.id);
      else if (msg?.type === 'deny') deny(msg.id);
    });
    conn.on('close', () => hosts.delete(conn));
  }

  function addGuest(conn, ip) {
    const guest = { id: nextGuestId++, ip, state: 'pending', conn };
    guests.set(guest.id, guest);
    conn.send({ type: 'hello', role: 'guest', state: 'pending' });
    sendHosts({ type: 'joinRequest', id: guest.id, ip });
    conn.on('message', (msg) => {
      if (msg?.type === 'cycle' && guest.state === 'approved') cycle(msg.button);
    });
    conn.on('close', () => {
      if (guests.delete(guest.id)) sendHosts({ type: 'guestLeft', id: guest.id });
    });
  }

  function endSession() {
    const msg = { type: 'sessionEnded' };
    sendHosts(msg);
    for (const g of [...guests.values()]) {
      guests.delete(g.id); // clear before close so no guestLeft echoes fire
      g.conn.send(msg);
      g.conn.close();
    }
    colors = [0, 0, 0];
  }

  function startSession() {
    colors = [0, 0, 0];
    broadcastColors();
  }

  function pingAll() {
    const msg = { type: 'ping' };
    sendHosts(msg);
    for (const g of guests.values()) g.conn.send(msg);
  }

  return { addHost, addGuest, endSession, startSession, pingAll };
}
