import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  seal, unseal, loadInstallKey, readState, writeState, deleteState, STATE_FILE,
} from '../../cli/lib/sealed-store.mjs';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const payload = { token: 'abc.def', highWater: 1_700_000_000_000, budgetUsedMs: 1234 };

describe('seal/unseal', () => {
  it('round-trips a payload', () => {
    expect(unseal(seal(payload, KEY_A), KEY_A)).toEqual(payload);
  });

  it('rejects a tampered payload', () => {
    const sealed = seal(payload, KEY_A);
    const forged = { ...sealed, payload: { ...payload, budgetUsedMs: 0 } };
    expect(unseal(forged, KEY_A)).toBeNull();
  });

  it('rejects a tampered mac and a wrong key', () => {
    const sealed = seal(payload, KEY_A);
    expect(unseal({ ...sealed, mac: sealed.mac.replace(/^./, sealed.mac[0] === '0' ? '1' : '0') }, KEY_A)).toBeNull();
    expect(unseal(sealed, KEY_B)).toBeNull();
  });

  it('rejects malformed containers', () => {
    expect(unseal(null as never, KEY_A)).toBeNull();
    expect(unseal({} as never, KEY_A)).toBeNull();
    expect(unseal({ payload, mac: 42 } as never, KEY_A)).toBeNull();
  });
});

describe('file layer', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'sealed-'));
  });

  it('loadInstallKey creates a 64-hex key once and reuses it', () => {
    const k1 = loadInstallKey(dir);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
    expect(loadInstallKey(dir)).toBe(k1);
  });

  it('write/read state round-trips through disk', () => {
    const key = loadInstallKey(dir);
    writeState(dir, key, payload);
    expect(readState(dir, key)).toEqual(payload);
  });

  it('readState deletes a hand-edited file and returns null', () => {
    const key = loadInstallKey(dir);
    writeState(dir, key, payload);
    const file = path.join(dir, STATE_FILE);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    raw.payload.budgetUsedMs = 0; // the classic cheat
    writeFileSync(file, JSON.stringify(raw));
    expect(readState(dir, key)).toBeNull();
    expect(existsSync(file)).toBe(false); // integrity failure → deleted
  });

  it('deleteState removes state and legacy grant.json', () => {
    const key = loadInstallKey(dir);
    writeState(dir, key, payload);
    writeFileSync(path.join(dir, 'grant.json'), '{}');
    deleteState(dir);
    expect(existsSync(path.join(dir, STATE_FILE))).toBe(false);
    expect(existsSync(path.join(dir, 'grant.json'))).toBe(false);
  });
});
