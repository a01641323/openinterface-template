# openinterface-template

A template for time-boxed, offline-capable access to a locally-run HTTP
interface. A Vercel app issues short-lived access codes; a curl-installed CLI
validates a code **once** online, then everything — session enforcement, LAN
guest approval, realtime sync — works with zero internet until the code's
timeout expires.

## Architecture

```
                    INTERNET (only for: install, validate-once, update, revocation poll)
┌──────────────────────────────────────────────┐
│  Vercel app (/app, Next.js)                  │        ┌─────────────┐
│                                              │◀──────▶│ Upstash     │
│  /            landing: request code,         │  REST  │ Redis       │
│               my-requests + live countdown   │        │ requests/   │
│  /admin       approve(timeout)/deny/revoke   │        │ codes       │
│  /api/validate  code → Ed25519-SIGNED GRANT  │        └─────────────┘
│  /install.sh  installer   /api/bundle  tarball                       
│  /api/version                                │   signs with SIGNING_PRIVATE_KEY
└──────────────┬───────────────────────────────┘   (public key ships in bundle)
               │ curl -fsSL {vercelUrl}/install.sh | bash
               ▼
┌──────────────────────────────────────────────────────────────────┐
│  HOST MACHINE   ~/.{commandName}/ = bundle + sealed session state │
│                                                                   │
│  {commandName} CLI (zero-dep Node)                                │
│   ├─ http://0.0.0.0:{port}  serves /interface                     │
│   ├─ grant verify OFFLINE: Ed25519 sig + expiry + clock guard     │
│   │    (high-water mark, monotonic budget, HMAC-sealed state)     │
│   ├─ SSE lifecycle + WebSocket /ws realtime (stdlib RFC6455)      │
│   └─ session slaved to host grant; ends → everyone drops          │
│                                                                   │
│   localhost = HOST ────────┐        LAN = GUESTS                  │
│   "Welcome [name]",        │   http://{hostLanIP}:{port}          │
│   approve/deny prompts,    │   waiting-for-approval → buttons-    │
│   3 synced color buttons   │   only view (or "no active session") │
└────────────────────────────┴──────────────────────────────────────┘
```

Re-branding for a new project touches **only [template.config.json](template.config.json)**:

```json
{ "commandName": "...", "brandName": "...", "port": 4321, "vercelUrl": "https://<app>.vercel.app" }
```

Prove it: `node scripts/verify-template.mjs` (static scan for hardcoded
literals + boots a renamed copy and checks every surface).

## Setup

### 1. Keys and env vars

| Var | Where it comes from |
|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash console → create a free Redis database → REST API section |
| `SIGNING_PRIVATE_KEY` | `node scripts/generate-keys.mjs` — run once; commits the public key to `shared/`, prints the private key (never committed) |
| `ADMIN_PASSWORD` | any password you choose for `/admin` |

### 2. Run locally

```bash
node scripts/generate-keys.mjs        # once
cd app
cp .env.example .env.local            # fill in all four vars
npm install
npm run dev                           # http://localhost:3000
npm test                              # unit tests (no Redis needed)
```

### 3. Deploy to Vercel

1. Push to GitHub, import in Vercel.
2. **Root Directory = `app`**, and confirm **Framework Preset = Next.js**
   (imported with the wrong root first, the preset sticks at "Other" and every
   route dies with `MIDDLEWARE_INVOCATION_FAILED`).
3. Enable *include source files outside of the Root Directory* (the build tars
   `../cli`, `../interface`, `../shared` into the bundle).
4. Add the four env vars — paste raw values, **no surrounding quotes**.
5. Deploy, put the real URL into `template.config.json` → `vercelUrl`, push
   again.

## User journey

1. **Request** — visitor opens the landing page, submits a name. An anonymous
   cookie tracks their requests; they see status + a live countdown once
   approved.
2. **Approve** — you open `/admin`, log in, approve with a timeout in minutes
   (or deny). Active codes show live countdowns; revoke/delete anytime.
3. **Install** — visitor runs the command shown on the landing page:
   `curl -fsSL {vercelUrl}/install.sh | bash` → bundle lands in
   `~/.{commandName}/`, launcher in `~/.local/bin/{commandName}`, per-install
   HMAC key created. Requires Node ≥18.
4. **Enter code** — `{commandName}` starts the local server and opens the
   browser; entering the code hits `/api/validate` — **the only internet call**
   — and stores the Ed25519-signed grant, verified locally before trust.
5. **Offline use** — refresh, close, reboot, disconnect wifi: the session
   restores from the sealed local state until the timeout. Enforcement is
   local: signature + wall clock + clock-tamper guards
   ([SECURITY-NOTES.md](SECURITY-NOTES.md)).
6. **LAN guests** — guests open `http://{hostLanIP}:{port}`, wait for the
   host's Allow/Deny. Approved guests get a buttons-only view; button colors
   sync in realtime over WebSocket for everyone. No internet involved.
7. **Expiry** — at the timeout (or budget exhaustion, or detected clock
   tampering, or revocation when online) the CLI deletes the grant and pushes
   `sessionEnded`: host and every guest drop to the code screen instantly,
   fully offline.

## Update flow

`{commandName} update` → GET `/api/version` (baked from `cli/package.json` at
deploy time) → if newer, downloads `/api/bundle` and atomically swaps
`cli/ interface/ shared/ template.config.json` in the install dir. The
install key and session state survive updates. Requires internet; fails with a
clear message offline; refuses to run inside a git checkout.

## Verification

- `cd app && npx vitest run` — unit suites for the web app store/lifecycle/
  tokens and the CLI (WS codec, realtime state machine, clock guard, sealed
  store).
- `node scripts/verify-template.mjs` — template rename proof.
- [docs/E2E-CHECKLIST.md](docs/E2E-CHECKLIST.md) — manual end-to-end checklist
  covering all ten original requirements.
- [SECURITY-NOTES.md](SECURITY-NOTES.md) — threat model and the honest list of
  what offline enforcement cannot prevent.
