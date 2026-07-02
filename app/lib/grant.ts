import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

// The grant token is what the stage-2 CLI stores locally: it proves the server
// approved this code and lets the CLI enforce expiresAt fully offline.
// Format: base64url(JSON payload) + "." + base64url(ed25519 signature over that JSON).
export interface GrantPayload {
  name: string;
  code: string;
  issuedAt: number;
  expiresAt: number;
}

export function signGrant(payload: GrantPayload, privateKeyDerBase64: string): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKeyDerBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const body = Buffer.from(JSON.stringify(payload));
  const sig = sign(null, body, key); // null algorithm = Ed25519 intrinsic
  return `${body.toString('base64url')}.${sig.toString('base64url')}`;
}

export function verifyGrant(token: string, publicKeyDerBase64: string): GrantPayload | null {
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
    return ok ? (JSON.parse(body.toString()) as GrantPayload) : null;
  } catch {
    return null;
  }
}
