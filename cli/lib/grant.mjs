import { createPublicKey, verify } from 'node:crypto';

// Mirror of the server's token format: base64url(JSON payload) + "." + base64url(Ed25519 sig).
// This is the offline half of the system — no network, just the embedded public key.
export function verifyGrantToken(token, publicKeyDerBase64) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyDerBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const body = Buffer.from(parts[0], 'base64url');
    const ok = verify(null, body, key, Buffer.from(parts[1], 'base64url'));
    return ok ? JSON.parse(body.toString()) : null;
  } catch {
    return null;
  }
}

export function isGrantActive(payload, now = Date.now()) {
  return Boolean(payload && typeof payload.expiresAt === 'number' && now < payload.expiresAt);
}
