import { describe, it, expect } from 'vitest';
import { evaluateSession, CLOCK_GRACE_MS, TICK_MS } from '../../cli/lib/clock-guard.mjs';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
// A one-hour grant issued 10 minutes "ago" relative to NOW.
const token = { issuedAt: NOW - 10 * 60_000, expiresAt: NOW + 50 * 60_000 };
const freshState = { highWater: NOW, budgetUsedMs: 10 * 60_000 };

describe('evaluateSession', () => {
  it('is active with sane clock and remaining budget', () => {
    const r = evaluateSession(token, freshState, NOW);
    expect(r.status).toBe('active');
    expect(r.remainingWallMs).toBe(50 * 60_000);
    expect(r.remainingBudgetMs).toBe(HOUR - 10 * 60_000);
  });

  it('expires when wall clock passes expiresAt', () => {
    expect(evaluateSession(token, freshState, token.expiresAt).status).toBe('expired');
    expect(evaluateSession(token, freshState, token.expiresAt + 1).status).toBe('expired');
  });

  it('detects clock rollback beyond the grace window', () => {
    const state = { ...freshState, highWater: NOW };
    expect(evaluateSession(token, state, NOW - CLOCK_GRACE_MS - 1).status).toBe('tampered');
  });

  it('tolerates small backwards clock adjustments inside the grace window (NTP)', () => {
    const state = { ...freshState, highWater: NOW };
    expect(evaluateSession(token, state, NOW - CLOCK_GRACE_MS + 1000).status).toBe('active');
  });

  it('ends the session when the monotonic budget is exhausted', () => {
    const state = { highWater: NOW, budgetUsedMs: HOUR };
    expect(evaluateSession(token, state, NOW).status).toBe('budget-exhausted');
    const over = { highWater: NOW, budgetUsedMs: HOUR + 1 };
    expect(evaluateSession(token, over, NOW).status).toBe('budget-exhausted');
  });

  it('whichever-first: rollback past expiry still reports tampered, not active', () => {
    // Clock rolled back to before issuedAt with a high-water mark from later:
    // wall check would pass, but the HWM catches it first.
    const state = { highWater: token.expiresAt - 1000, budgetUsedMs: 0 };
    expect(evaluateSession(token, state, token.issuedAt).status).toBe('tampered');
  });

  it('budget wins even when wall time looks fine (frozen clock scenario)', () => {
    const state = { highWater: NOW, budgetUsedMs: HOUR + 5000 };
    expect(evaluateSession(token, state, NOW).status).toBe('budget-exhausted');
  });

  it('exports sane constants', () => {
    expect(CLOCK_GRACE_MS).toBeGreaterThan(0);
    expect(TICK_MS).toBeGreaterThan(0);
    expect(TICK_MS).toBeLessThan(CLOCK_GRACE_MS);
  });
});
