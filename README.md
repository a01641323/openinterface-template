# openinterface-template

A template: a Vercel-hosted app ([app/](app/)) issues time-limited access codes
for a locally-run HTTP interface. Stage 1 = this web app. Stage 2 = the CLI
([cli/](cli/)) and static interface ([interface/](interface/)).

## Re-branding

Edit **template.config.json** only:

```json
{ "commandName": "...", "brandName": "...", "port": 4321, "vercelUrl": "https://<your-app>.vercel.app" }
```

Everything (page titles, install command, installer script) reads from it.
After deploying, set `vercelUrl` to your real deployment URL and redeploy.

## Environment variables

| Var | Where to get it |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash console → your Redis database → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | same place |
| `SIGNING_PRIVATE_KEY` | printed by `node scripts/generate-keys.mjs` (run once; commits the public key to `shared/`, prints the private key) |
| `ADMIN_PASSWORD` | any password you choose for /admin |

## Run locally

```bash
node scripts/generate-keys.mjs        # once; copy the printed private key
cd app
cp .env.example .env.local            # fill in all four vars
npm install
npm run dev                           # http://localhost:3000
npm test                              # unit tests (no Redis needed)
```

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel.
2. Set the project **Root Directory** to `app` and check that **Framework
   Preset** says **Next.js** (if the project was first imported with the wrong
   root directory, the preset sticks at "Other" and middleware breaks with
   `MIDDLEWARE_INVOCATION_FAILED` — fix it in Settings → Build and Deployment).
   The build tars `../cli` and `../interface` into the bundle, so also enable
   the option to include source files outside the root directory.
3. Add the four environment variables (Project → Settings → Environment
   Variables). Paste raw values **without surrounding quotes**.
4. Deploy, then put the deployment URL into `template.config.json` → `vercelUrl`
   and push again.

## CLI (stage 2)

End users install with the command shown on the landing page:

```bash
curl -fsSL https://<your-app>.vercel.app/install.sh | bash
```

This downloads the bundle (`cli/`, `interface/`, `shared/`,
`template.config.json`) into `~/.{commandName}/` and installs a launcher at
`~/.local/bin/{commandName}` (with a PATH hint if needed). Requires Node ≥18.

- `{commandName}` — serves the interface at `http://localhost:{port}`
  (bound to 0.0.0.0 for LAN access) and opens the browser. `--no-open` skips
  the browser; `NO_OPEN=1` works too.
- `{commandName} update` — checks `/api/version`, downloads `/api/bundle` and
  atomically replaces the install if newer. Requires internet; fails with a
  clear message offline. Refuses to run inside a git checkout.

### Offline access model

Validating a code is the only internet call the CLI ever makes. On success the
Vercel API returns an Ed25519-signed grant token which the CLI stores at
`~/.{commandName}/grant.json` **after verifying the signature itself** against
`shared/signing-public-key.b64` (shipped in the bundle). From then on:

- every interface load re-verifies the token locally (signature + expiry) —
  valid sessions survive refreshes, restarts, and having no internet at all;
- a timer in the CLI fires exactly at `expiresAt`: the grant is deleted and the
  interface is pushed back to the code screen via SSE (with client-side timer
  and polling as fallbacks);
- tampered or expired grant files are deleted on sight;
- revoking a code takes effect at the next *online* validation — an offline
  machine keeps its session until `expiresAt` by design.

## API summary

- `POST /api/requests` `{name}` — create access request (anonymous cookie identifies the requester)
- `GET /api/requests` — own requests + codes
- `DELETE /api/requests/:id` — delete own request
- `POST /api/admin/login` `{password}` — admin session cookie
- `GET /api/admin/state` · `POST /api/admin/approve` `{requestId, timeoutMinutes}` · `POST /api/admin/deny` · `POST /api/admin/revoke` `{code}` · `DELETE /api/admin/requests/:id` · `DELETE /api/admin/codes/:code`
- `POST /api/validate` `{code}` → `{token, name, expiresAt}` — token is
  `base64url(JSON{name, code, issuedAt, expiresAt}) + "." + base64url(Ed25519 sig)`,
  verifiable offline with `shared/signing-public-key.b64`
- `GET /install.sh` · `GET /api/version` · `GET /api/bundle`

## Code lifecycle

```
request: pending ──deny──▶ denied
         pending ──approve(timeoutMinutes)──▶ approved ──creates──▶ code
code:    active ──revoke──▶ revoked
         active ──now > expiresAt──▶ expired   (lazy: applied on read, no cron)
```
