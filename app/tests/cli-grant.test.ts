import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyGrantToken, isGrantActive } from '../../cli/lib/grant.mjs';

function testKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { privateKey, pub: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
}

function makeToken(payload: object, privateKey: import('node:crypto').KeyObject): string {
  const body = Buffer.from(JSON.stringify(payload));
  return `${body.toString('base64url')}.${sign(null, body, privateKey).toString('base64url')}`;
}

const payload = { name: 'Alice', code: 'ABCD2345', issuedAt: 1000, expiresAt: 2000 };

describe('cli verifyGrantToken', () => {
  it('accepts a token signed with the matching key', () => {
    const { privateKey, pub } = testKeys();
    expect(verifyGrantToken(makeToken(payload, privateKey), pub)).toEqual(payload);
  });

  it('rejects a token signed with a different key', () => {
    const a = testKeys();
    const b = testKeys();
    expect(verifyGrantToken(makeToken(payload, a.privateKey), b.pub)).toBeNull();
  });

  it('rejects tampered payloads and malformed tokens', () => {
    const { privateKey, pub } = testKeys();
    const [, sig] = makeToken(payload, privateKey).split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, expiresAt: 9e12 })).toString('base64url');
    expect(verifyGrantToken(`${forged}.${sig}`, pub)).toBeNull();
    expect(verifyGrantToken('garbage', pub)).toBeNull();
    expect(verifyGrantToken('', pub)).toBeNull();
  });
});

describe('cli isGrantActive', () => {
  it('is active strictly before expiresAt', () => {
    expect(isGrantActive(payload, 1999)).toBe(true);
    expect(isGrantActive(payload, 2000)).toBe(false);
    expect(isGrantActive(payload, 2001)).toBe(false);
  });
  it('handles null and malformed payloads', () => {
    expect(isGrantActive(null, 0)).toBe(false);
    expect(isGrantActive({ name: 'x' } as never, 0)).toBe(false);
  });
});
