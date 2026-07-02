import { randomInt } from 'node:crypto';
import type { AccessCode, CodeStatus } from './types';

// No 0/O/1/I/L to keep codes unambiguous when read aloud or typed.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateCode(): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function computeExpiresAt(approvedAt: number, timeoutMinutes: number): number {
  return approvedAt + timeoutMinutes * 60_000;
}

export function effectiveCodeStatus(
  code: Pick<AccessCode, 'status' | 'expiresAt'>,
  now: number,
): CodeStatus {
  if (code.status === 'revoked') return 'revoked';
  if (code.status === 'expired') return 'expired';
  return now > code.expiresAt ? 'expired' : 'active';
}
