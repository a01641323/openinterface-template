# openinterface-template Stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Executed inline in the authoring session.

**Goal:** Curl-installable Node CLI that serves the local interface, validates an access code online exactly once, then enforces the timeout fully offline via the Ed25519 grant token.

**Architecture:** Zero-dependency Node CLI in `/cli` (stdlib http/crypto/fs/os). The bundle tar gains `shared/` + `template.config.json` so `~/.{commandName}/` mirrors the repo layout — the CLI resolves everything relative to its own file and runs identically from repo or install. Static interface in `/interface` (vanilla JS, no CSS framework) talks only to the local CLI server.

**Tech Stack:** Node ≥18 (global fetch), Ed25519 via `node:crypto`, SSE for instant expiry push, Vitest (tests live in `app/tests`, importing CLI modules directly).

---

## Token lifecycle (decided up front)

```
validate (ONLINE, once) → CLI forwards code to {vercelUrl}/api/validate
   └─ 200: CLI verifies token signature itself (embedded public key) before storing
   └─ 401: reason passthrough → interface shows "invalid code" / "code expired"
   └─ network error: "offline" — validation requires internet, everything else doesn't
store → ~/.{commandName}/grant.json  (token is self-contained: name/code/issuedAt/expiresAt)
offline verify → every GET /api/local/session re-verifies signature + now < expiresAt
   └─ valid → granted view (restart/refresh restores session), NO network
   └─ invalid → delete grant.json → code screen
expire → CLI timer fires exactly at expiresAt (chunked setTimeout for >24.8d):
   delete grant.json + SSE "expired" event → interface drops to code screen immediately
   (client fallbacks: local setTimeout at expiresAt + 15s polling)
cleanup → any failed verify deletes grant.json; revocation applies at next ONLINE validation
```

## File structure

```
cli/
├── package.json            # version 0.2.0 (source of /api/version + update comparisons)
├── index.mjs               # dispatch: (default)=serve+open browser, update, --no-open
└── lib/
    ├── config.mjs          # resolves rootDir from own path; loads template.config.json,
    │                       #   public key (../shared/signing-public-key.b64), dataDir, baseUrl
    ├── grant.mjs           # verifyGrantToken(token, pubB64) → payload|null; isGrantActive(payload, now)
    ├── versions.mjs        # isNewerVersion(remote, local) — numeric dot-segment compare
    ├── net.mjs             # lanIp() — first non-internal IPv4
    ├── store.mjs           # read/write/delete ~/.{cmd}/grant.json
    ├── server.mjs          # static serving (traversal-safe) + local API:
    │                       #   GET  /api/local/session   → {state:granted,name,expiresAt,lanIp,port,brandName} | {state:locked,...}
    │                       #   POST /api/local/validate  → forwards to vercel, verifies, stores, schedules
    │                       #   GET  /api/local/events    → SSE, "expired" event
    └── update.mjs          # /api/version compare → download /api/bundle → extract tmp → atomic swap
                            #   refuses to run inside a git checkout (protects the repo)

interface/
├── index.html              # code screen + granted view (two divs, zero design)
└── app.js                  # session fetch → render; code submit; LAN join (http://IP:{port});
                            #   3 color-cycling buttons; SSE + timer + poll expiry handling

app/ (changes)
├── scripts/make-bundle.mjs # tar now includes: cli interface shared template.config.json
└── app/install.sh/route.ts # real installer: bundle → ~/.{cmd}/, launcher → ~/.local/bin/{cmd},
                            #   PATH hint, node/tar preflight, INSTALL_BASE env override for testing
```

## Tasks

1. **Housekeeping**: commit pending stage-1 fixes (page.tsx slash-strip, vercelUrl edit), this plan.
2. **CLI pure logic (TDD)**: grant verify (round-trip, tamper, expiry), version compare — tests in `app/tests/cli-*.test.ts` importing the `.mjs` modules.
3. **CLI runtime**: config/store/server/update/index; bump cli to 0.2.0.
4. **Interface**: both screens, error texts exactly "invalid code" / "code expired", LAN join input, welcome + LAN IP + 3 color-cycling buttons.
5. **App side**: real install.sh, bundle contents extended; verify tarball.
6. **Local E2E** (no admin needed): craft a short-lived grant signed with the local private key (`app/.env.local` — same pair as production, proven in stage-1 validation) → session granted with zero network → SSE `expired` fires at expiresAt → grant.json deleted → session locked. Installer dry-run against local dev server via INSTALL_BASE.
7. **Docs**: README stage-2 sections + manual wifi-off test script.

## Verification

- `cd app && npx vitest run` — all suites incl. new cli-grant/cli-versions.
- Local E2E per task 6 (offline verify + expiry without internet).
- `bash <(curl local install.sh)` with INSTALL_BASE pointing at local dev server → installs to a temp HOME, launcher runs.
- Manual production script (deliverable): install → request/approve code → validate → wifi off → interface still granted → stays offline through expiry → locks at expiresAt → wifi on → update command.
