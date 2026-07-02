import { describe, it, expect } from 'vitest';
import { adminSessionToken, isValidAdminSession } from '../lib/admin-auth';

describe('admin session', () => {
  it('token is deterministic for a password and differs across passwords', () => {
    expect(adminSessionToken('hunter2')).toBe(adminSessionToken('hunter2'));
    expect(adminSessionToken('hunter2')).not.toBe(adminSessionToken('other'));
    expect(adminSessionToken('hunter2')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('validates only the exact token', () => {
    const token = adminSessionToken('hunter2');
    expect(isValidAdminSession(token, 'hunter2')).toBe(true);
    expect(isValidAdminSession(token + 'x', 'hunter2')).toBe(false);
    expect(isValidAdminSession('', 'hunter2')).toBe(false);
    expect(isValidAdminSession(undefined, 'hunter2')).toBe(false);
    expect(isValidAdminSession(token, 'different-password')).toBe(false);
  });
});
