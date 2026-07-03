# Security notes — offline session enforcement

The CLI enforces grant expiry with **no internet access**. That constraint has a
hard ceiling: an attacker with root on their own machine ultimately controls
every clock and every file the CLI can see. The goal of the defenses below is
to make cheating *genuinely annoying* — casual attacks fail, and determined
attacks require scripting against the internals, not just dragging a clock
slider. This document is honest about where the ceiling is.

## What the grant token guarantees (cryptographically solid)

The grant token is `base64url(JSON{name, code, issuedAt, expiresAt})` +
Ed25519 signature, minted by the server with a private key that never leaves
Vercel. The CLI verifies it with the public key shipped in the bundle
(`shared/signing-public-key.b64`). Consequences:

- `expiresAt`/`issuedAt` **cannot be forged or edited** — any change breaks the
  signature.
- Nobody can mint a session without the server approving a code first.

Everything below is about *time*, the one input the server can't sign.

## Defense layers

1. **High-water mark.** The CLI persists the newest wall-clock time it has ever
   observed (updated every 5s while running). If the current time reads earlier
   than that mark minus a 90s grace (NTP adjustments happen), the clock was
   rolled back → the session is invalidated immediately.
2. **Monotonic budget.** While the CLI runs, elapsed time is accumulated from
   `process.hrtime.bigint()` — the monotonic clock, immune to wall-clock
   changes — and persisted. The session ends when EITHER the wall clock passes
   `expiresAt` OR accumulated runtime reaches `expiresAt − issuedAt`, whichever
   fires first. Freezing or rewinding the wall clock therefore caps total
   usable runtime at exactly the granted window.
3. **Sealed state.** Token + high-water mark + budget live in one file
   (`session.json`) protected by HMAC-SHA256 with a per-install random key
   (`install-key`, created by the installer, mode 600). Hand-editing any byte
   invalidates the file → it is deleted → code screen. All enforcement exits
   through one path that also force-drops every LAN guest (SSE + WebSocket
   `sessionEnded`).
4. **Opportunistic online re-check.** While a session is active, every 45s the
   CLI re-validates the code against `{vercelUrl}/api/validate` *if the network
   happens to work*. An explicit 401 (revoked / expired / deleted server-side)
   kills the session and propagates to guests. Network errors are ignored —
   this check is never required, per the offline-first design.

## Remaining bypasses (not preventable offline — acknowledged)

- **Re-sealing forged state.** The HMAC key sits on the same disk as the data
  it protects, readable by the user. Anyone who reads this codebase can write
  a script that loads `install-key`, resets `highWater`/`budgetUsedMs`, and
  re-seals — then roll the clock back and repeat indefinitely. The signature
  on the token still pins `expiresAt`, but time cheating becomes unbounded.
  There is no offline fix: a secret the CLI can read is a secret its owner can
  read.
- **Snapshot / restore.** Copy `~/.{commandName}/` while the session is fresh,
  restore it later together with a clock rollback (or inside a VM snapshot) —
  the restored state is internally consistent and validates. Undetectable
  offline.
- **Clock interposition** (`libfaketime`, patched Node, kernel-level fakery)
  lies to both the wall clock *and* the monotonic clock. Game over by
  construction.
- **Grace-window nibbling.** Rollbacks smaller than the 90s grace are accepted
  by design (NTP reality); repeated abuse yields at most ~90s per CLI restart.
- **The revocation poll only helps online.** A machine kept offline holds its
  session until the (budget-capped) window ends, revoked or not. This is the
  documented stage-2 contract.

## Practical posture

For the intended use — handing time-boxed access codes to people you already
trust enough to let onto your LAN — the layers stop every casual approach:
clock-slider rollback (caught by high-water mark), pausing the clock (caught
by budget), editing the file (caught by HMAC). If your threat model includes
users who will reverse-engineer the client, shorten the timeouts and rely on
the online re-check; do not rely on offline enforcement.

## Verified by

- Unit: `app/tests/cli-clock-guard.test.ts`, `app/tests/cli-sealed-store.test.ts`.
- Live integration (this repo's finalization pass): hand-edited state rejected
  and deleted; forged future high-water mark → session invalidated at boot;
  budget exhaustion fired with the wall clock showing an hour left and
  force-dropped a connected LAN guest; valid state restored across restarts
  with budget accumulating monotonically.
