import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { signGrant, verifyGrant, type GrantPayload } from '../lib/grant';

function testKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    priv: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    pub: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

const payload: GrantPayload = { name: 'Alice', code: 'ABCD2345', issuedAt: 1000, expiresAt: 2000 };

describe('grant tokens', () => {
  it('round-trips: sign then verify returns the payload', () => {
    const { priv, pub } = testKeys();
    const token = signGrant(payload, priv);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); // b64url.b64url
    expect(verifyGrant(token, pub)).toEqual(payload);
  });

  it('rejects a token signed with a different key', () => {
    const a = testKeys();
    const b = testKeys();
    expect(verifyGrant(signGrant(payload, a.priv), b.pub)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const { priv, pub } = testKeys();
    const [, sig] = signGrant(payload, priv).split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, expiresAt: 9_999_999 })).toString('base64url');
    expect(verifyGrant(`${forged}.${sig}`, pub)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    const { pub } = testKeys();
    expect(verifyGrant('not-a-token', pub)).toBeNull();
    expect(verifyGrant('', pub)).toBeNull();
  });
});
