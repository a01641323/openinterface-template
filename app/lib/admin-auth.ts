import { createHmac, timingSafeEqual } from 'node:crypto';

// Session cookie value is an HMAC derived from ADMIN_PASSWORD: stateless, no
// user accounts, and rotating the password invalidates all sessions.
export function adminSessionToken(password: string): string {
  return createHmac('sha256', password).update('admin-session-v1').digest('hex');
}

export function isValidAdminSession(
  cookieValue: string | undefined,
  password: string,
): boolean {
  if (!cookieValue) return false;
  const expected = Buffer.from(adminSessionToken(password));
  const actual = Buffer.from(cookieValue);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
