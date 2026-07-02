import { describe, it, expect } from 'vitest';
import { generateCode, computeExpiresAt, effectiveCodeStatus } from '../lib/lifecycle';

describe('generateCode', () => {
  it('returns 8 uppercase chars from the safe alphabet', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });

  it('returns different codes on subsequent calls', () => {
    expect(generateCode()).not.toBe(generateCode());
  });
});

describe('computeExpiresAt', () => {
  it('adds timeoutMinutes in ms', () => {
    expect(computeExpiresAt(1_000_000, 30)).toBe(1_000_000 + 30 * 60_000);
  });
});

describe('effectiveCodeStatus', () => {
  const base = { expiresAt: 2_000_000 };
  it('active stays active before expiresAt', () => {
    expect(effectiveCodeStatus({ ...base, status: 'active' }, 1_999_999)).toBe('active');
  });
  it('active becomes expired after expiresAt', () => {
    expect(effectiveCodeStatus({ ...base, status: 'active' }, 2_000_001)).toBe('expired');
  });
  it('revoked stays revoked even before expiresAt', () => {
    expect(effectiveCodeStatus({ ...base, status: 'revoked' }, 1_000_000)).toBe('revoked');
  });
  it('expired stays expired', () => {
    expect(effectiveCodeStatus({ ...base, status: 'expired' }, 0)).toBe('expired');
  });
});
