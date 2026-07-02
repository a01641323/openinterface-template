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
2. Set the project **Root Directory** to `app`. The build tars `../cli` and
   `../interface` into the bundle, so the deployment must include files outside
   the root directory — in Vercel's Root Directory settings enable the option
   to include source files outside the root directory (if your Vercel plan/UI
   doesn't show that option, I don't know an alternative other than making the
   repo root the project root and adding a root-level build config).
3. Add the four environment variables (Project → Settings → Environment Variables).
4. Deploy, then put the deployment URL into `template.config.json` → `vercelUrl`
   and push again.

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
