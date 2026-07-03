// Offline clock-tamper defense (pure logic; persistence in sealed-store.mjs).
//
// Two independent limits, whichever fires first ends the session:
//  - wall clock:      now >= expiresAt
//  - monotonic budget: accumulated CLI runtime >= (expiresAt - issuedAt)
// Plus a high-water mark: if the wall clock ever reads earlier than the newest
// time we've observed (minus a small grace for NTP adjustments), the clock was
// rolled back → tampered.
//
// See SECURITY-NOTES.md for the honest list of what this cannot prevent.

export const CLOCK_GRACE_MS = 90_000;
export const TICK_MS = 5_000;

// tokenPayload: { issuedAt, expiresAt } (from the verified grant token)
// state:        { highWater, budgetUsedMs }
export function evaluateSession(tokenPayload, state, now = Date.now()) {
  if (now < state.highWater - CLOCK_GRACE_MS) return { status: 'tampered' };
  if (now >= tokenPayload.expiresAt) return { status: 'expired' };
  const totalBudgetMs = tokenPayload.expiresAt - tokenPayload.issuedAt;
  if (state.budgetUsedMs >= totalBudgetMs) return { status: 'budget-exhausted' };
  return {
    status: 'active',
    remainingWallMs: tokenPayload.expiresAt - now,
    remainingBudgetMs: totalBudgetMs - state.budgetUsedMs,
  };
}
