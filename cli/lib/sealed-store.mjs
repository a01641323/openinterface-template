import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

// All persisted session state (grant token + clock high-water mark + monotonic
// budget) lives in ONE file, sealed with an HMAC keyed by a per-install random
// key. Hand-editing any byte invalidates the whole thing. This raises the bar
// against casual clock cheating; see SECURITY-NOTES.md for what it does NOT
// prevent (a local attacker can read the key and re-seal).

export const KEY_FILE = 'install-key';
export const STATE_FILE = 'session.json';

export function seal(payload, keyHex) {
  const body = JSON.stringify(payload);
  const mac = createHmac('sha256', Buffer.from(keyHex, 'hex')).update(body).digest('hex');
  return { payload, mac };
}

export function unseal(container, keyHex) {
  if (!container || typeof container !== 'object') return null;
  if (container.payload === undefined || typeof container.mac !== 'string') return null;
  const body = JSON.stringify(container.payload);
  const expected = createHmac('sha256', Buffer.from(keyHex, 'hex')).update(body).digest('hex');
  const actual = Buffer.from(container.mac);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  return container.payload;
}

// Created by the installer; self-healed here for repo/dev runs. chmod 600 —
// the key protects against hand-editing, not against reading (see notes).
export function loadInstallKey(dataDir) {
  const file = path.join(dataDir, KEY_FILE);
  try {
    const key = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(key)) return key;
  } catch {
    /* missing or unreadable → regenerate */
  }
  const key = randomBytes(32).toString('hex');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, key + '\n', { mode: 0o600 });
  return key;
}

export function readState(dataDir, keyHex) {
  const file = path.join(dataDir, STATE_FILE);
  let container;
  try {
    container = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const payload = unseal(container, keyHex);
  if (!payload) {
    rmSync(file, { force: true }); // integrity failure → delete on sight
    return null;
  }
  return payload;
}

export function writeState(dataDir, keyHex, payload) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, STATE_FILE), JSON.stringify(seal(payload, keyHex)));
}

export function deleteState(dataDir) {
  rmSync(path.join(dataDir, STATE_FILE), { force: true });
  rmSync(path.join(dataDir, 'grant.json'), { force: true }); // legacy stage-2 file
}
