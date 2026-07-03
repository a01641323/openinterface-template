# openinterface-template Finalization: Clock-Tamper Defense + Template Verification

## Context

Stages 1–3 delivered the full system. Two gaps remain before the template is "done": (1) a user can extend an offline session by rolling their system clock back — perfect prevention is impossible offline, but defense-in-depth can make it genuinely annoying; (2) the template claim ("rename by editing only template.config.json") has never been proven, and the docs lack the full architecture/journey/checklist treatment.

## TASK 1 — clock-tamper defense in depth

### Threat analysis (drives the design; goes in SECURITY-NOTES.md)

| Attack | Counter |
|---|---|
| Roll clock back while CLI stopped, restart | **High-water mark**: persisted max-ever-observed wall time; `now < highWater − 90s grace` ⇒ tampered ⇒ grant deleted |
| Roll clock back while CLI runs | **Monotonic budget**: runtime accumulated via `process.hrtime.bigint()`; session ends when budget ≥ `expiresAt − issuedAt` OR wall expiry — whichever first |
| Freeze the clock | Wall never expires but budget caps total runtime at the grant window |
| Hand-edit persisted state | **HMAC-SHA256 seal** over the whole state with a per-install random key (created at install, self-healed on first run, chmod 600); any mismatch ⇒ delete ⇒ code screen |
| Not preventable offline (documented honestly) | Re-sealing forged state using the readable install key; snapshot/restore of the whole data dir + rollback; `libfaketime`-style clock interposition; VM snapshots. Backstop = the existing 45s opportunistic online revalidation (stage 3), which is never *required* |

### Design

One integrity-protected state file `~/.{commandName}/session.json` replaces `grant.json`:

```
{ "payload": { "token": <signed grant>, "highWater": ms, "budgetUsedMs": ms }, "mac": hmac_hex }
```

- **In-memory-authoritative while running**: server loads state once (startup or validate), holds it in memory, persists every 5s tick. Each tick: `highWater = max(highWater, Date.now())`, `budgetUsedMs += monotonicDelta`, persist, then evaluate — any violation ⇒ the existing `endSession()` (grant deleted, SSE `expired`, WS `sessionEnded`, guests force-dropped — full stage-3 fan-out reused).
- **Session active iff**: token signature valid ∧ `now < expiresAt` ∧ `now ≥ highWater − 90s` ∧ `budgetUsedMs < expiresAt − issuedAt`.
- **Timers**: existing wall timer (`scheduleExpiry`) + new budget timer armed for `remainingBudget` ms of runtime (Node timers are monotonic under libuv, immune to wall changes).
- Fresh validate ⇒ `{token, highWater: now, budgetUsedMs: 0}`. Legacy `grant.json` deleted if found. `update` swap list untouched ⇒ install-key + session.json survive updates.
- Installer creates `install-key` (32 random bytes hex, via node) if absent; CLI self-creates on first run (repo/dev mode).

### Files (Task 1)

| File | Change |
|---|---|
| `cli/lib/sealed-store.mjs` | **new** — pure `seal(payload,key)`/`unseal(obj,key)` (HMAC-SHA256, timing-safe) + `loadInstallKey`/`readState`/`writeState`/`deleteState` |
| `cli/lib/clock-guard.mjs` | **new, pure** — `evaluateSession({tokenPayload, highWater, budgetUsedMs}, now)` → `active|expired|tampered|budget-exhausted` + remaining times; constants `CLOCK_GRACE_MS=90_000`, `TICK_MS=5_000` |
| `cli/lib/server.mjs` | replace grant.json flow: in-memory sealed state, 5s tick (persist + violation check), budget timer, tampered/exhausted ⇒ `endSession()`; validate writes fresh state; delete legacy grant.json |
| `cli/lib/store.mjs` | **delete** (superseded by sealed-store) |
| `app/app/install.sh/route.ts` | generate `install-key` at install time if absent |
| `app/tests/cli-sealed-store.test.ts` | **new TDD** — roundtrip, payload tamper ⇒ null, mac tamper ⇒ null, wrong key ⇒ null |
| `app/tests/cli-clock-guard.test.ts` | **new TDD** — active, wall expiry, hwm violation (incl. inside grace = ok), budget exhaustion, whichever-first semantics |
| `SECURITY-NOTES.md` | **new** — threat model, defenses, honest remaining-bypass list above |

Reused: `verifyGrantToken` (grant.mjs), `endSession` fan-out, revocation poll (stage 3 = Task 1.4 already done — documented, not rebuilt).

## TASK 2 — template verification + docs

1. **`scripts/verify-template.mjs`** (standalone, `node scripts/verify-template.mjs`):
   - greps runtime code (`cli/`, `interface/`, `app/app`, `app/lib`, `app/scripts`, `scripts/`) for forbidden literals (`openinterface`, `Open Interface`, the port, the vercel host) — docs/tests/config excluded by design, tests asserted separately;
   - copies `cli/ interface/ shared/` + a **rewritten** config (`opendash`, `Open Dash`, port 5321, `https://opendash.example.com`) to a temp dir, boots that CLI with a sandboxed `CLI_DATA_DIR`, asserts: `--version` works, usage line says `opendash`, `/api/local/session` reports `brandName: "Open Dash"`, `port: 5321`, and the config module's derived `dataDir` ends in `.opendash`;
   - prints PASS/FAIL per check, non-zero exit on failure.
2. **Fix found hardcodes**: remove unused `"bin"` from `cli/package.json` (the installer's launcher owns the command name); rewrite `app/tests/smoke.test.ts` to assert config *shape* (types/https) not literal values so a renamed template still passes its own test suite.
3. **README.md rewrite**: ASCII architecture diagram (Vercel app ⇄ Upstash; browser↔landing/admin; CLI: installer → local server → interface, host/guest over LAN WS; grant token flow), setup (Upstash creds, `SIGNING_PRIVATE_KEY` via generate-keys, `ADMIN_PASSWORD`, Vercel deploy incl. the root-directory/framework-preset/no-quotes pitfalls learned earlier), full user journey (request → approve → curl install → code → offline use → LAN guests → expiry), update flow, link to SECURITY-NOTES + checklist.
4. **`docs/E2E-CHECKLIST.md`**: the 10 original requirements, each with a concrete manual step — request+countdown, admin approve/deny/revoke/delete, signed validate w/ lazy expiry, curl install, CLI serve+code entry (single online call), refresh/reopen keeps session offline, timeout drops host AND guests offline, revoke-while-online (≤45s), guest approval + realtime colors both directions, denied guest sees "access denied" (+ disconnect fallback, update command).

## Verification

- **Unit:** `cd app && npx vitest run` — existing 53 + new sealed-store/clock-guard suites; `npx tsc --noEmit`; `npm run build`.
- **Template proof:** `node scripts/verify-template.mjs` → all PASS.
- **Live integration (sandboxed CLI_DATA_DIR, unreachable vercelUrl rig from stage 3):**
  1. legally-sealed fresh session (updated test helper writes install-key + sealed session.json) → `/api/local/session` granted;
  2. hand-edit one byte of payload → session locked, file deleted (HMAC);
  3. seal state with `highWater = now + 10min` (simulates post-rollback restart) → tampered → locked;
  4. seal state with `budgetUsedMs = total − 3s`, wall expiry far away → session ends ~3s after boot via the budget timer; connected WS guest receives `sessionEnded` (fan-out on tamper path);
  5. restart with a valid mid-budget state → session restores (offline refresh/reopen still works).
- Clock-rollback itself can't be simulated at system level without root; the pure clock-guard tests + the forged-state integrations above cover every branch of the logic.
