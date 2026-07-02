# openinterface-template Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **On approval, save this plan to** `docs/superpowers/plans/2026-07-02-openinterface-stage1.md` in the repo before starting Task 1.

**Goal:** Build the monorepo scaffold and complete Vercel-hosted Next.js app for "openinterface-template" — a system that issues time-limited, Ed25519-signed access codes for a locally-run HTTP interface.

**Architecture:** Next.js App Router app in `/app` backed by Upstash Redis. Pure logic (code lifecycle, grant-token signing, timer formatting) lives in unit-tested lib modules; Redis access goes through a thin store layer tested against an in-memory `FakeRedis`. Pages are plain-HTML client components that call the JSON API. All branding/naming reads from root `template.config.json`.

**Tech Stack:** Next.js 15 (App Router, TypeScript), React 19, `@upstash/redis`, Node `node:crypto` (Ed25519), Vitest.

---

## Context

The user is building a reusable template: a Vercel app is the "gatekeeper" that issues short-lived access codes; a stage-2 CLI will validate a code against `/api/validate`, receive a signed grant token, and enforce the timeout fully offline using an embedded public key. Stage 1 delivers the monorepo scaffold, the whole web app (landing + admin), the code-lifecycle API, the signing infrastructure, and the update plumbing (`/api/version`, `/api/bundle`, `/install.sh` stub). Renaming the project for a new template instance must touch only `template.config.json`.

### Code lifecycle (design, decided up front)

```
request: pending ──deny──▶ denied (terminal)
         pending ──approve(timeoutMinutes)──▶ approved
                                  │ creates
                                  ▼
code:    active ──admin revoke──▶ revoked (terminal)
         active ──now > expiresAt──▶ expired (terminal, applied lazily)
```

- `expiresAt = approvedAt + timeoutMinutes * 60_000` (ms epoch, computed once at approval).
- **Lazy expiration:** no cron. Every read path (`/api/validate`, landing list, admin list) computes the *effective* status via `effectiveCodeStatus(code, now)` and persists the `active → expired` transition when observed.
- **Drift-proof timers:** the shared `Countdown` component re-renders every second but always computes remaining time from the absolute `expiresAt` timestamp.
- Deleting a request cascades to its linked code; deleting/revoking never resurrects anything.

### Redis data model

| Key | Value |
|---|---|
| `request:{id}` | `AccessRequest` JSON (upstash auto-serializes objects) |
| `requests:index` | Set of all request ids |
| `code:{CODE}` | `AccessCode` JSON |
| `codes:index` | Set of all code strings |
| `request_code:{requestId}` | code string (link for cascade delete / join) |

### API surface

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/requests` | POST | cookieId cookie | Create pending request `{name}` → 201 |
| `/api/requests` | GET | cookieId cookie (or `?cookieId=` fallback) | Own requests joined with codes, lazy-expired |
| `/api/requests/[id]` | DELETE | cookieId must match owner | Delete own request + linked code |
| `/api/admin/login` | POST | password vs `ADMIN_PASSWORD` | Sets httpOnly `admin_session` cookie |
| `/api/admin/state` | GET | admin session | All requests + all codes (lazy-expired) for the dashboard |
| `/api/admin/approve` | POST | admin session | `{requestId, timeoutMinutes}` → creates active code |
| `/api/admin/deny` | POST | admin session | `{requestId}` |
| `/api/admin/revoke` | POST | admin session | `{code}` |
| `/api/admin/requests/[id]` | DELETE | admin session | Delete any request (+ linked code) |
| `/api/admin/codes/[code]` | DELETE | admin session | Delete any code record |
| `/api/validate` | POST | none (code is the secret) | `{code}` → signed grant token, or 401 `{reason}` |
| `/install.sh` | GET | none | Installer stub (text) |
| `/api/version` | GET | none | `{version}` from `cli/package.json` (baked at build) |
| `/api/bundle` | GET | none | Redirects to `/bundle.tar.gz` built by prebuild script |

**Grant token format:** `base64url(JSON{name, code, issuedAt, expiresAt})` + `"."` + `base64url(ed25519_signature)`. Private key: env `SIGNING_PRIVATE_KEY` (PKCS8 DER, base64). Public key: `shared/signing-public-key.b64` (SPKI DER, base64), committed, embedded by the CLI in stage 2.

**Env vars:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `SIGNING_PRIVATE_KEY`, `ADMIN_PASSWORD`.

### File structure

```
/ (repo root — currently EMPTY, git init in Task 1)
├── template.config.json          # the ONLY file touched when re-branding
├── README.md                     # setup, env vars, local dev, deploy (Task 16)
├── .gitignore
├── scripts/generate-keys.mjs     # Ed25519 keygen (Task 2)
├── shared/signing-public-key.b64 # committed public key (Task 2)
├── cli/                          # stage-2 placeholder
│   ├── package.json              # { "version": "0.1.0" } — source of /api/version
│   └── index.mjs                 # placeholder
├── interface/index.html          # stage-2 placeholder
└── app/                          # Next.js app, Vercel root directory
    ├── package.json  tsconfig.json  next.config.mjs  .env.example
    ├── middleware.ts             # sets anonymous cookieId cookie
    ├── scripts/make-bundle.mjs   # prebuild: tar ../cli ../interface → public/bundle.tar.gz
    ├── lib/
    │   ├── types.ts              # AccessRequest, AccessCode, statuses
    │   ├── lifecycle.ts          # generateCode, computeExpiresAt, effectiveCodeStatus
    │   ├── grant.ts              # signGrant, verifyGrant (Ed25519)
    │   ├── store.ts              # RedisLike interface + all Redis CRUD/lifecycle ops
    │   ├── redis.ts              # getRedis() — real @upstash/redis client
    │   ├── admin-auth.ts         # adminSessionToken, isValidAdminSession (pure)
    │   └── require-admin.ts      # requireAdmin() — reads cookie, server-only
    ├── tests/
    │   ├── fake-redis.ts         # in-memory RedisLike
    │   ├── lifecycle.test.ts  grant.test.ts  store.test.ts
    │   ├── admin-auth.test.ts  countdown-format.test.ts
    ├── app/
    │   ├── layout.tsx  page.tsx  admin/page.tsx
    │   ├── components/Countdown.tsx   # shared live timer (landing + admin)
    │   ├── install.sh/route.ts
    │   └── api/
    │       ├── requests/route.ts  requests/[id]/route.ts
    │       ├── admin/{login,state,approve,deny,revoke}/route.ts
    │       ├── admin/requests/[id]/route.ts  admin/codes/[code]/route.ts
    │       ├── validate/route.ts  version/route.ts  bundle/route.ts
```

**Convention:** relative imports everywhere (no `@/` alias) so Vitest needs zero config. All timestamps are ms-epoch numbers. Codes are uppercase, 8 chars, ambiguity-free alphabet.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `.gitignore`, `template.config.json`, `cli/package.json`, `cli/index.mjs`, `interface/index.html`

- [ ] **Step 1: Init git repo**

```bash
cd /Users/matiashidalgo/Documents/templates/interface
git init -b main
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
node_modules/
.next/
.env
.env.local
.env*.local
app/public/bundle.tar.gz
.DS_Store
```

- [ ] **Step 3: Write `template.config.json`**

```json
{
  "commandName": "openinterface",
  "brandName": "Open Interface",
  "port": 4321,
  "vercelUrl": "https://REPLACE_ME.vercel.app"
}
```

- [ ] **Step 4: Write `cli/package.json`** (version here is what `/api/version` reports)

```json
{
  "name": "cli",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "bin": { "openinterface": "index.mjs" }
}
```

- [ ] **Step 5: Write `cli/index.mjs`**

```js
#!/usr/bin/env node
// Stage 2 will implement the real CLI (validate code, run interface, offline timeout).
console.log('CLI placeholder — implemented in stage 2');
```

- [ ] **Step 6: Write `interface/index.html`**

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Interface placeholder</title></head>
  <body><p>Static interface files land here in stage 2.</p></body>
</html>
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: monorepo scaffold (config, cli/interface placeholders)"
```

---

### Task 2: Ed25519 keypair script + shared public key

**Files:**
- Create: `scripts/generate-keys.mjs`, `shared/signing-public-key.b64` (generated)

- [ ] **Step 1: Write `scripts/generate-keys.mjs`**

```js
#!/usr/bin/env node
// Generates an Ed25519 keypair for grant-token signing.
// Public key (SPKI DER, base64) → shared/signing-public-key.b64 (committed; CLI embeds it in stage 2).
// Private key (PKCS8 DER, base64) → printed once; set as SIGNING_PRIVATE_KEY env var. Never committed.
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');

mkdirSync(path.join(repoRoot, 'shared'), { recursive: true });
writeFileSync(path.join(repoRoot, 'shared', 'signing-public-key.b64'), pub + '\n');

console.log('Public key written to shared/signing-public-key.b64');
console.log('\nAdd this to app/.env.local AND your Vercel project env vars:');
console.log(`SIGNING_PRIVATE_KEY=${priv}`);
```

- [ ] **Step 2: Run it and verify output**

```bash
node scripts/generate-keys.mjs
cat shared/signing-public-key.b64
```

Expected: prints `SIGNING_PRIVATE_KEY=MC4CAQAwBQYDK2VwBCIEI...` (~64 base64 chars) and the file contains one base64 line (~44 chars for SPKI ed25519 is 44 bytes → ~60 base64 chars).

- [ ] **Step 3: Save the private key for local dev** — create `app/.env.local` later (Task 3 creates `app/`); for now paste the printed `SIGNING_PRIVATE_KEY=...` line somewhere safe (it is re-printable only by regenerating, which would invalidate the committed public key).

- [ ] **Step 4: Commit** (public key only — `.env*` is gitignored)

```bash
git add scripts/generate-keys.mjs shared/signing-public-key.b64
git commit -m "feat: Ed25519 keygen script and committed signing public key"
```

---

### Task 3: Next.js app scaffold

**Files:**
- Create: `app/package.json`, `app/tsconfig.json`, `app/next.config.mjs`, `app/.env.example`, `app/app/layout.tsx`, `app/app/page.tsx` (temp stub), `app/tests/smoke.test.ts`

- [ ] **Step 1: Write `app/package.json`**

```json
{
  "name": "app",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "predev": "node scripts/make-bundle.mjs",
    "dev": "next dev",
    "prebuild": "node scripts/make-bundle.mjs",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "@upstash/redis": "^1.35.0",
    "next": "^15.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

(`predev`/`prebuild` run `scripts/make-bundle.mjs`. Its real content lands in Task 12; Step 2 below creates a no-op stub now so `npm run dev` works from this task onward.)

- [ ] **Step 2: Write stub `app/scripts/make-bundle.mjs`**

```js
// Replaced in the bundle task: tars ../cli and ../interface into public/bundle.tar.gz
```

- [ ] **Step 3: Write `app/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Write `app/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

- [ ] **Step 5: Write `app/.env.example`** (committed; documents required env vars)

```bash
# Upstash Redis REST credentials (Upstash console → your database → REST API)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
# From: node scripts/generate-keys.mjs (repo root)
SIGNING_PRIVATE_KEY=
# Admin dashboard password
ADMIN_PASSWORD=
```

- [ ] **Step 6: Write `app/app/layout.tsx`**

```tsx
import config from '../../template.config.json';

export const metadata = { title: config.brandName };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Write temporary `app/app/page.tsx`** (replaced in Task 14)

```tsx
export default function Home() {
  return <main>placeholder</main>;
}
```

- [ ] **Step 8: Install dependencies**

```bash
cd /Users/matiashidalgo/Documents/templates/interface/app
npm install
```

Expected: lockfile created, no errors.

- [ ] **Step 9: Write failing smoke test `app/tests/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import config from '../../template.config.json';

describe('template config', () => {
  it('has the four required fields', () => {
    expect(config.commandName).toBe('openinterface');
    expect(config.brandName).toBe('Open Interface');
    expect(config.port).toBe(4321);
    expect(config.vercelUrl).toMatch(/^https:\/\//);
  });
});
```

- [ ] **Step 10: Run tests**

Run: `cd app && npx vitest run`
Expected: PASS (1 test). This proves vitest + JSON imports work.

- [ ] **Step 11: Verify the app builds and boots**

```bash
cd app && npx next build
```

Expected: build succeeds (no Redis/env needed — nothing server-side yet).

- [ ] **Step 12: Create `app/.env.local`** (gitignored) — copy `.env.example`, fill `SIGNING_PRIVATE_KEY` from Task 2, fill Upstash creds (create a free database at console.upstash.com if you don't have one — copy the REST URL and token from the database's "REST API" section), pick any `ADMIN_PASSWORD`.

- [ ] **Step 13: Commit**

```bash
git add app
git commit -m "feat: Next.js app scaffold with vitest"
```

---

### Task 4: Types + lifecycle logic (TDD)

**Files:**
- Create: `app/lib/types.ts`, `app/lib/lifecycle.ts`
- Test: `app/tests/lifecycle.test.ts`

- [ ] **Step 1: Write `app/lib/types.ts`** (types only, no test needed)

```ts
export type RequestStatus = 'pending' | 'approved' | 'denied';
export type CodeStatus = 'active' | 'expired' | 'revoked';

export interface AccessRequest {
  id: string;
  name: string;
  cookieId: string;
  status: RequestStatus;
  createdAt: number; // ms epoch
}

export interface AccessCode {
  code: string; // 8-char uppercase
  requestId: string;
  name: string;
  timeoutMinutes: number;
  approvedAt: number; // ms epoch
  expiresAt: number; // ms epoch
  status: CodeStatus;
}
```

- [ ] **Step 2: Write failing tests `app/tests/lifecycle.test.ts`**

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/lifecycle.test.ts`
Expected: FAIL — cannot resolve `../lib/lifecycle`.

- [ ] **Step 4: Write `app/lib/lifecycle.ts`**

```ts
import { randomInt } from 'node:crypto';
import type { AccessCode, CodeStatus } from './types';

// No 0/O/1/I/L to keep codes unambiguous when read aloud or typed.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateCode(): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function computeExpiresAt(approvedAt: number, timeoutMinutes: number): number {
  return approvedAt + timeoutMinutes * 60_000;
}

export function effectiveCodeStatus(
  code: Pick<AccessCode, 'status' | 'expiresAt'>,
  now: number,
): CodeStatus {
  if (code.status === 'revoked') return 'revoked';
  if (code.status === 'expired') return 'expired';
  return now > code.expiresAt ? 'expired' : 'active';
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/lifecycle.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add app/lib/types.ts app/lib/lifecycle.ts app/tests/lifecycle.test.ts
git commit -m "feat: code lifecycle logic (generation, expiry computation, lazy status)"
```

---

### Task 5: Grant token signing (TDD)

**Files:**
- Create: `app/lib/grant.ts`
- Test: `app/tests/grant.test.ts`

- [ ] **Step 1: Write failing tests `app/tests/grant.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { signGrant, verifyGrant, type GrantPayload } from '../lib/grant';

function testKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    priv: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    pub: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

const payload: GrantPayload = { name: 'Alice', code: 'ABCD2345', issuedAt: 1000, expiresAt: 2000 };

describe('grant tokens', () => {
  it('round-trips: sign then verify returns the payload', () => {
    const { priv, pub } = testKeys();
    const token = signGrant(payload, priv);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); // b64url.b64url
    expect(verifyGrant(token, pub)).toEqual(payload);
  });

  it('rejects a token signed with a different key', () => {
    const a = testKeys();
    const b = testKeys();
    expect(verifyGrant(signGrant(payload, a.priv), b.pub)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const { priv, pub } = testKeys();
    const [, sig] = signGrant(payload, priv).split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, expiresAt: 9_999_999 })).toString('base64url');
    expect(verifyGrant(`${forged}.${sig}`, pub)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    const { pub } = testKeys();
    expect(verifyGrant('not-a-token', pub)).toBeNull();
    expect(verifyGrant('', pub)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/grant.test.ts`
Expected: FAIL — cannot resolve `../lib/grant`.

- [ ] **Step 3: Write `app/lib/grant.ts`**

```ts
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

// The grant token is what the stage-2 CLI stores locally: it proves the server
// approved this code and lets the CLI enforce expiresAt fully offline.
// Format: base64url(JSON payload) + "." + base64url(ed25519 signature over that JSON).
export interface GrantPayload {
  name: string;
  code: string;
  issuedAt: number;
  expiresAt: number;
}

export function signGrant(payload: GrantPayload, privateKeyDerBase64: string): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKeyDerBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const body = Buffer.from(JSON.stringify(payload));
  const sig = sign(null, body, key); // null algorithm = Ed25519 intrinsic
  return `${body.toString('base64url')}.${sig.toString('base64url')}`;
}

export function verifyGrant(token: string, publicKeyDerBase64: string): GrantPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyDerBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const body = Buffer.from(parts[0], 'base64url');
    const ok = verify(null, body, key, Buffer.from(parts[1], 'base64url'));
    return ok ? (JSON.parse(body.toString()) as GrantPayload) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/grant.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/grant.ts app/tests/grant.test.ts
git commit -m "feat: Ed25519 grant token sign/verify"
```

---

### Task 6: Store layer + FakeRedis (TDD)

**Files:**
- Create: `app/lib/store.ts`, `app/tests/fake-redis.ts`
- Test: `app/tests/store.test.ts`

- [ ] **Step 1: Write `app/tests/fake-redis.ts`** (test helper — in-memory implementation of the same interface the real client satisfies)

```ts
import type { RedisLike } from '../lib/store';

export class FakeRedis implements RedisLike {
  private data = new Map<string, unknown>();
  private sets = new Map<string, Set<string>>();

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  }
  async set(key: string, value: unknown): Promise<unknown> {
    this.data.set(key, value);
    return 'OK';
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.data.delete(k)) n++;
      if (this.sets.delete(k)) n++;
    }
    return n;
  }
  async sadd(key: string, ...members: string[]): Promise<number> {
    const s = this.sets.get(key) ?? new Set<string>();
    for (const m of members) s.add(m);
    this.sets.set(key, s);
    return members.length;
  }
  async srem(key: string, ...members: string[]): Promise<number> {
    const s = this.sets.get(key);
    if (!s) return 0;
    let n = 0;
    for (const m of members) if (s.delete(m)) n++;
    return n;
  }
  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }
}
```

- [ ] **Step 2: Write failing tests `app/tests/store.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { FakeRedis } from './fake-redis';
import {
  createRequest, getRequest, listRequestsByCookie, listAllRequests, deleteRequest,
  approveRequest, denyRequest, getCode, getCodeForRequest, listAllCodes,
  revokeCode, deleteCode, resolveCode,
} from '../lib/store';

const NOW = 1_700_000_000_000;

describe('requests', () => {
  it('createRequest stores a pending request retrievable by id and cookie', async () => {
    const redis = new FakeRedis();
    const req = await createRequest(redis, 'Alice', 'cookie-a');
    expect(req.status).toBe('pending');
    expect(req.name).toBe('Alice');
    expect(await getRequest(redis, req.id)).toEqual(req);
    expect(await listRequestsByCookie(redis, 'cookie-a')).toEqual([req]);
    expect(await listRequestsByCookie(redis, 'cookie-b')).toEqual([]);
  });

  it('listAllRequests returns every request, newest first', async () => {
    const redis = new FakeRedis();
    const a = await createRequest(redis, 'A', 'c1');
    const b = await createRequest(redis, 'B', 'c2');
    // force distinct createdAt ordering
    await redis.set(`request:${a.id}`, { ...a, createdAt: 1 });
    await redis.set(`request:${b.id}`, { ...b, createdAt: 2 });
    const all = await listAllRequests(redis);
    expect(all.map((r) => r.name)).toEqual(['B', 'A']);
  });

  it('denyRequest marks pending request denied; refuses non-pending', async () => {
    const redis = new FakeRedis();
    const req = await createRequest(redis, 'Alice', 'c');
    const denied = await denyRequest(redis, req.id);
    expect(denied?.status).toBe('denied');
    expect(await denyRequest(redis, req.id)).toBeNull(); // already denied
    expect(await denyRequest(redis, 'nope')).toBeNull();
  });
});

describe('approve → code', () => {
  it('approveRequest creates an active code and marks the request approved', async () => {
    const redis = new FakeRedis();
    const req = await createRequest(redis, 'Alice', 'c');
    const code = await approveRequest(redis, req.id, 30, NOW);
    expect(code).not.toBeNull();
    expect(code!.status).toBe('active');
    expect(code!.name).toBe('Alice');
    expect(code!.approvedAt).toBe(NOW);
    expect(code!.expiresAt).toBe(NOW + 30 * 60_000);
    expect(code!.code).toMatch(/^[A-Z2-9]{8}$/);
    expect((await getRequest(redis, req.id))!.status).toBe('approved');
    expect(await getCode(redis, code!.code)).toEqual(code);
    expect(await getCodeForRequest(redis, req.id)).toEqual(code);
    expect(await listAllCodes(redis)).toEqual([code]);
  });

  it('approveRequest refuses non-pending requests', async () => {
    const redis = new FakeRedis();
    const req = await createRequest(redis, 'Alice', 'c');
    await approveRequest(redis, req.id, 30, NOW);
    expect(await approveRequest(redis, req.id, 30, NOW)).toBeNull();
    expect(await approveRequest(redis, 'missing', 30, NOW)).toBeNull();
  });
});

describe('code lifecycle in storage', () => {
  async function activeCode(redis: FakeRedis) {
    const req = await createRequest(redis, 'Alice', 'c');
    return (await approveRequest(redis, req.id, 30, NOW))!;
  }

  it('revokeCode marks a code revoked', async () => {
    const redis = new FakeRedis();
    const code = await activeCode(redis);
    const revoked = await revokeCode(redis, code.code);
    expect(revoked?.status).toBe('revoked');
    expect((await getCode(redis, code.code))!.status).toBe('revoked');
    expect(await revokeCode(redis, 'MISSING1')).toBeNull();
  });

  it('resolveCode lazily persists expiry when past expiresAt', async () => {
    const redis = new FakeRedis();
    const code = await activeCode(redis);
    const resolved = await resolveCode(redis, code, code.expiresAt + 1);
    expect(resolved.status).toBe('expired');
    expect((await getCode(redis, code.code))!.status).toBe('expired'); // persisted
  });

  it('resolveCode leaves active codes untouched before expiry', async () => {
    const redis = new FakeRedis();
    const code = await activeCode(redis);
    const resolved = await resolveCode(redis, code, code.expiresAt - 1);
    expect(resolved.status).toBe('active');
  });
});

describe('deletion', () => {
  it('deleteRequest cascades to the linked code', async () => {
    const redis = new FakeRedis();
    const req = await createRequest(redis, 'Alice', 'c');
    const code = (await approveRequest(redis, req.id, 30, NOW))!;
    await deleteRequest(redis, req.id);
    expect(await getRequest(redis, req.id)).toBeNull();
    expect(await getCode(redis, code.code)).toBeNull();
    expect(await listAllCodes(redis)).toEqual([]);
    expect(await listAllRequests(redis)).toEqual([]);
  });

  it('deleteCode removes the code and its request link', async () => {
    const redis = new FakeRedis();
    const req = await createRequest(redis, 'Alice', 'c');
    const code = (await approveRequest(redis, req.id, 30, NOW))!;
    await deleteCode(redis, code.code);
    expect(await getCode(redis, code.code)).toBeNull();
    expect(await getCodeForRequest(redis, req.id)).toBeNull();
    expect(await getRequest(redis, req.id)).not.toBeNull(); // request survives
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/store.test.ts`
Expected: FAIL — cannot resolve `../lib/store`.

- [ ] **Step 4: Write `app/lib/store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { AccessCode, AccessRequest } from './types';
import { computeExpiresAt, effectiveCodeStatus, generateCode } from './lifecycle';

// Minimal surface of @upstash/redis we use; FakeRedis implements it for tests.
// @upstash/redis auto-serializes objects on set and deserializes on get.
export interface RedisLike {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
}

const REQUESTS_INDEX = 'requests:index';
const CODES_INDEX = 'codes:index';
const requestKey = (id: string) => `request:${id}`;
const codeKey = (code: string) => `code:${code}`;
const linkKey = (requestId: string) => `request_code:${requestId}`;

// ---- requests ----

export async function createRequest(
  redis: RedisLike,
  name: string,
  cookieId: string,
): Promise<AccessRequest> {
  const request: AccessRequest = {
    id: randomUUID(),
    name,
    cookieId,
    status: 'pending',
    createdAt: Date.now(),
  };
  await redis.set(requestKey(request.id), request);
  await redis.sadd(REQUESTS_INDEX, request.id);
  return request;
}

export async function getRequest(redis: RedisLike, id: string): Promise<AccessRequest | null> {
  return redis.get<AccessRequest>(requestKey(id));
}

export async function listAllRequests(redis: RedisLike): Promise<AccessRequest[]> {
  const ids = await redis.smembers(REQUESTS_INDEX);
  const requests = await Promise.all(ids.map((id) => redis.get<AccessRequest>(requestKey(id))));
  return requests
    .filter((r): r is AccessRequest => r !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function listRequestsByCookie(
  redis: RedisLike,
  cookieId: string,
): Promise<AccessRequest[]> {
  return (await listAllRequests(redis)).filter((r) => r.cookieId === cookieId);
}

export async function denyRequest(redis: RedisLike, id: string): Promise<AccessRequest | null> {
  const request = await getRequest(redis, id);
  if (!request || request.status !== 'pending') return null;
  const updated: AccessRequest = { ...request, status: 'denied' };
  await redis.set(requestKey(id), updated);
  return updated;
}

export async function deleteRequest(redis: RedisLike, id: string): Promise<void> {
  const code = await redis.get<string>(linkKey(id));
  if (code) {
    await redis.del(codeKey(code), linkKey(id));
    await redis.srem(CODES_INDEX, code);
  }
  await redis.del(requestKey(id));
  await redis.srem(REQUESTS_INDEX, id);
}

// ---- codes ----

export async function approveRequest(
  redis: RedisLike,
  requestId: string,
  timeoutMinutes: number,
  now: number = Date.now(),
): Promise<AccessCode | null> {
  const request = await getRequest(redis, requestId);
  if (!request || request.status !== 'pending') return null;
  const code: AccessCode = {
    code: generateCode(),
    requestId,
    name: request.name,
    timeoutMinutes,
    approvedAt: now,
    expiresAt: computeExpiresAt(now, timeoutMinutes),
    status: 'active',
  };
  await redis.set(requestKey(requestId), { ...request, status: 'approved' } satisfies AccessRequest);
  await redis.set(codeKey(code.code), code);
  await redis.sadd(CODES_INDEX, code.code);
  await redis.set(linkKey(requestId), code.code);
  return code;
}

export async function getCode(redis: RedisLike, code: string): Promise<AccessCode | null> {
  return redis.get<AccessCode>(codeKey(code));
}

export async function getCodeForRequest(
  redis: RedisLike,
  requestId: string,
): Promise<AccessCode | null> {
  const code = await redis.get<string>(linkKey(requestId));
  return code ? getCode(redis, code) : null;
}

export async function listAllCodes(redis: RedisLike): Promise<AccessCode[]> {
  const codes = await redis.smembers(CODES_INDEX);
  const records = await Promise.all(codes.map((c) => redis.get<AccessCode>(codeKey(c))));
  return records
    .filter((c): c is AccessCode => c !== null)
    .sort((a, b) => b.approvedAt - a.approvedAt);
}

export async function revokeCode(redis: RedisLike, code: string): Promise<AccessCode | null> {
  const record = await getCode(redis, code);
  if (!record) return null;
  const updated: AccessCode = { ...record, status: 'revoked' };
  await redis.set(codeKey(code), updated);
  return updated;
}

export async function deleteCode(redis: RedisLike, code: string): Promise<void> {
  const record = await getCode(redis, code);
  if (record) await redis.del(linkKey(record.requestId));
  await redis.del(codeKey(code));
  await redis.srem(CODES_INDEX, code);
}

// Lazy expiration: persist the active→expired transition the moment any read observes it.
export async function resolveCode(
  redis: RedisLike,
  code: AccessCode,
  now: number,
): Promise<AccessCode> {
  const status = effectiveCodeStatus(code, now);
  if (status === code.status) return code;
  const updated: AccessCode = { ...code, status };
  await redis.set(codeKey(code.code), updated);
  return updated;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/store.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add app/lib/store.ts app/tests/fake-redis.ts app/tests/store.test.ts
git commit -m "feat: Redis store layer with lazy expiration, tested against FakeRedis"
```

---

### Task 7: Real Redis client + cookieId middleware

**Files:**
- Create: `app/lib/redis.ts`, `app/middleware.ts`

- [ ] **Step 1: Write `app/lib/redis.ts`**

```ts
import { Redis } from '@upstash/redis';
import type { RedisLike } from './store';

let client: RedisLike | null = null;

export function getRedis(): RedisLike {
  if (!client) {
    // Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN from the environment.
    client = Redis.fromEnv() as unknown as RedisLike;
  }
  return client;
}
```

(The cast is needed because upstash's method signatures are wider generics; the runtime behavior matches `RedisLike`, which `FakeRedis` mirrors in tests.)

- [ ] **Step 2: Write `app/middleware.ts`** — anonymous identity on first visit

```ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  if (req.cookies.get('cookieId')) return NextResponse.next();
  const res = NextResponse.next();
  res.cookies.set('cookieId', crypto.randomUUID(), {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  return res;
}
```

- [ ] **Step 3: Verify middleware compiles and sets the cookie**

```bash
cd app && npx next dev --port 3000 &
sleep 5
curl -sI http://localhost:3000/ | grep -i set-cookie
kill %1
```

Expected: a `Set-Cookie: cookieId=<uuid>...` header.

- [ ] **Step 4: Commit**

```bash
git add app/lib/redis.ts app/middleware.ts
git commit -m "feat: upstash client and anonymous cookieId middleware"
```

---

### Task 8: Admin auth (TDD) + login route

**Files:**
- Create: `app/lib/admin-auth.ts`, `app/lib/require-admin.ts`, `app/app/api/admin/login/route.ts`
- Test: `app/tests/admin-auth.test.ts`

- [ ] **Step 1: Write failing tests `app/tests/admin-auth.test.ts`**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/admin-auth.test.ts`
Expected: FAIL — cannot resolve `../lib/admin-auth`.

- [ ] **Step 3: Write `app/lib/admin-auth.ts`** (pure — testable without Next)

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

// Session cookie value is an HMAC derived from ADMIN_PASSWORD: stateless, no
// user accounts, and rotating the password invalidates all sessions.
export function adminSessionToken(password: string): string {
  return createHmac('sha256', password).update('admin-session-v1').digest('hex');
}

export function isValidAdminSession(
  cookieValue: string | undefined,
  password: string,
): boolean {
  if (!cookieValue) return false;
  const expected = Buffer.from(adminSessionToken(password));
  const actual = Buffer.from(cookieValue);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/admin-auth.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `app/lib/require-admin.ts`**

```ts
import { cookies } from 'next/headers';
import { isValidAdminSession } from './admin-auth';

export const ADMIN_COOKIE = 'admin_session';

export async function requireAdmin(): Promise<boolean> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  const store = await cookies();
  return isValidAdminSession(store.get(ADMIN_COOKIE)?.value, password);
}
```

- [ ] **Step 6: Write `app/app/api/admin/login/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { adminSessionToken } from '../../../../lib/admin-auth';
import { ADMIN_COOKIE } from '../../../../lib/require-admin';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function POST(req: Request) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return NextResponse.json({ error: { code: 'not_configured', message: 'ADMIN_PASSWORD is not set' } }, { status: 500 });
  }
  const body = await req.json().catch(() => null);
  const attempt = typeof body?.password === 'string' ? body.password : '';
  if (!attempt || !safeEqual(attempt, password)) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Wrong password' } }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminSessionToken(password), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
```

- [ ] **Step 7: Verify login manually** (needs `ADMIN_PASSWORD` in `app/.env.local`)

```bash
cd app && npx next dev --port 3000 &
sleep 5
curl -si -X POST http://localhost:3000/api/admin/login -H 'Content-Type: application/json' -d '{"password":"WRONG"}' | head -1
curl -si -X POST http://localhost:3000/api/admin/login -H 'Content-Type: application/json' -d "{\"password\":\"$(grep ADMIN_PASSWORD .env.local | cut -d= -f2)\"}" | grep -iE 'HTTP|set-cookie'
kill %1
```

Expected: first request `HTTP/1.1 401`, second `HTTP/1.1 200` with `Set-Cookie: admin_session=<64 hex chars>`.

- [ ] **Step 8: Commit**

```bash
git add app/lib/admin-auth.ts app/lib/require-admin.ts app/app/api/admin/login/route.ts app/tests/admin-auth.test.ts
git commit -m "feat: admin password login with HMAC session cookie"
```

---

### Task 9: User request API routes

**Files:**
- Create: `app/app/api/requests/route.ts`, `app/app/api/requests/[id]/route.ts`

- [ ] **Step 1: Write `app/app/api/requests/route.ts`** (POST create, GET list-own)

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRedis } from '../../../lib/redis';
import {
  createRequest, listRequestsByCookie, getCodeForRequest, resolveCode,
} from '../../../lib/store';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'name is required (max 100 chars)' } },
      { status: 400 },
    );
  }
  const cookieStore = await cookies();
  const cookieId = cookieStore.get('cookieId')?.value;
  if (!cookieId) {
    return NextResponse.json(
      { error: { code: 'missing_cookie', message: 'cookieId cookie not set' } },
      { status: 400 },
    );
  }
  const request = await createRequest(getRedis(), name, cookieId);
  return NextResponse.json({ request }, { status: 201 });
}

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const cookieId =
    cookieStore.get('cookieId')?.value ??
    new URL(req.url).searchParams.get('cookieId') ??
    '';
  if (!cookieId) return NextResponse.json({ requests: [] });

  const redis = getRedis();
  const now = Date.now();
  const requests = await listRequestsByCookie(redis, cookieId);
  const withCodes = await Promise.all(
    requests.map(async (r) => {
      const code = await getCodeForRequest(redis, r.id);
      return { ...r, grantedCode: code ? await resolveCode(redis, code, now) : null };
    }),
  );
  return NextResponse.json({ requests: withCodes });
}
```

- [ ] **Step 2: Write `app/app/api/requests/[id]/route.ts`** (DELETE own, cookie-scoped)

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRedis } from '../../../../lib/redis';
import { getRequest, deleteRequest } from '../../../../lib/store';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const cookieId = cookieStore.get('cookieId')?.value;
  const redis = getRedis();
  const request = await getRequest(redis, id);
  // 404 for both missing and not-owned: don't leak other users' request ids.
  if (!request || !cookieId || request.cookieId !== cookieId) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Request not found' } },
      { status: 404 },
    );
  }
  await deleteRequest(redis, id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify with curl** (needs Upstash creds in `app/.env.local`)

```bash
cd app && npx next dev --port 3000 &
sleep 5
curl -s -X POST http://localhost:3000/api/requests -H 'Content-Type: application/json' -b 'cookieId=curl-test' -d '{"name":"Alice"}'
curl -s http://localhost:3000/api/requests -b 'cookieId=curl-test'
curl -s http://localhost:3000/api/requests -b 'cookieId=someone-else'
kill %1
```

Expected: 1) `{"request":{"id":"...","name":"Alice","status":"pending",...}}`; 2) that request in `requests` with `"grantedCode":null`; 3) `{"requests":[]}`.

- [ ] **Step 4: Delete it and verify scoping**

```bash
cd app && npx next dev --port 3000 &
sleep 5
ID=$(curl -s http://localhost:3000/api/requests -b 'cookieId=curl-test' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).requests[0].id))')
curl -si -X DELETE "http://localhost:3000/api/requests/$ID" -b 'cookieId=wrong-cookie' | head -1
curl -si -X DELETE "http://localhost:3000/api/requests/$ID" -b 'cookieId=curl-test' | head -1
kill %1
```

Expected: first DELETE `HTTP/1.1 404`, second `HTTP/1.1 200`.

- [ ] **Step 5: Commit**

```bash
git add app/app/api/requests
git commit -m "feat: user request API (create, list own with codes, cookie-scoped delete)"
```

---

### Task 10: Admin API routes

**Files:**
- Create: `app/app/api/admin/state/route.ts`, `app/app/api/admin/approve/route.ts`, `app/app/api/admin/deny/route.ts`, `app/app/api/admin/revoke/route.ts`, `app/app/api/admin/requests/[id]/route.ts`, `app/app/api/admin/codes/[code]/route.ts`

All admin routes start with the same guard — every mutation requires the admin session:

```ts
if (!(await requireAdmin())) {
  return NextResponse.json(
    { error: { code: 'unauthorized', message: 'Admin session required' } },
    { status: 401 },
  );
}
```

- [ ] **Step 1: Write `app/app/api/admin/state/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/require-admin';
import { getRedis } from '../../../../lib/redis';
import { listAllRequests, listAllCodes, resolveCode } from '../../../../lib/store';

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Admin session required' } },
      { status: 401 },
    );
  }
  const redis = getRedis();
  const now = Date.now();
  const [requests, rawCodes] = await Promise.all([listAllRequests(redis), listAllCodes(redis)]);
  const codes = await Promise.all(rawCodes.map((c) => resolveCode(redis, c, now)));
  return NextResponse.json({ requests, codes });
}
```

- [ ] **Step 2: Write `app/app/api/admin/approve/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/require-admin';
import { getRedis } from '../../../../lib/redis';
import { approveRequest } from '../../../../lib/store';

export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Admin session required' } },
      { status: 401 },
    );
  }
  const body = await req.json().catch(() => null);
  const requestId = typeof body?.requestId === 'string' ? body.requestId : '';
  const timeoutMinutes = Number(body?.timeoutMinutes);
  if (!requestId || !Number.isInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 60 * 24 * 30) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'requestId and timeoutMinutes (1..43200) required' } },
      { status: 400 },
    );
  }
  const code = await approveRequest(getRedis(), requestId, timeoutMinutes);
  if (!code) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Request not found or not pending' } },
      { status: 404 },
    );
  }
  return NextResponse.json({ code }, { status: 201 });
}
```

- [ ] **Step 3: Write `app/app/api/admin/deny/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/require-admin';
import { getRedis } from '../../../../lib/redis';
import { denyRequest } from '../../../../lib/store';

export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Admin session required' } },
      { status: 401 },
    );
  }
  const body = await req.json().catch(() => null);
  const requestId = typeof body?.requestId === 'string' ? body.requestId : '';
  if (!requestId) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'requestId required' } },
      { status: 400 },
    );
  }
  const denied = await denyRequest(getRedis(), requestId);
  if (!denied) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Request not found or not pending' } },
      { status: 404 },
    );
  }
  return NextResponse.json({ request: denied });
}
```

- [ ] **Step 4: Write `app/app/api/admin/revoke/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/require-admin';
import { getRedis } from '../../../../lib/redis';
import { revokeCode } from '../../../../lib/store';

export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Admin session required' } },
      { status: 401 },
    );
  }
  const body = await req.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code.toUpperCase() : '';
  if (!code) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'code required' } },
      { status: 400 },
    );
  }
  const revoked = await revokeCode(getRedis(), code);
  if (!revoked) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Code not found' } },
      { status: 404 },
    );
  }
  return NextResponse.json({ code: revoked });
}
```

- [ ] **Step 5: Write `app/app/api/admin/requests/[id]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/require-admin';
import { getRedis } from '../../../../../lib/redis';
import { deleteRequest } from '../../../../../lib/store';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Admin session required' } },
      { status: 401 },
    );
  }
  const { id } = await params;
  await deleteRequest(getRedis(), id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Write `app/app/api/admin/codes/[code]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/require-admin';
import { getRedis } from '../../../../../lib/redis';
import { deleteCode } from '../../../../../lib/store';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  if (!(await requireAdmin())) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Admin session required' } },
      { status: 401 },
    );
  }
  const { code } = await params;
  await deleteCode(getRedis(), code.toUpperCase());
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Verify guard + full approve flow with curl**

```bash
cd app && npx next dev --port 3000 &
sleep 5
# unauthenticated mutation is rejected
curl -si -X POST http://localhost:3000/api/admin/approve -H 'Content-Type: application/json' -d '{"requestId":"x","timeoutMinutes":5}' | head -1
# login, keep cookie jar
PASS=$(grep ADMIN_PASSWORD .env.local | cut -d= -f2)
curl -s -c /tmp/admin.jar -X POST http://localhost:3000/api/admin/login -H 'Content-Type: application/json' -d "{\"password\":\"$PASS\"}"
# create a request as a user, then approve it as admin
curl -s -X POST http://localhost:3000/api/requests -H 'Content-Type: application/json' -b 'cookieId=curl-test2' -d '{"name":"Bob"}'
ID=$(curl -s http://localhost:3000/api/requests -b 'cookieId=curl-test2' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).requests[0].id))')
curl -s -b /tmp/admin.jar -X POST http://localhost:3000/api/admin/approve -H 'Content-Type: application/json' -d "{\"requestId\":\"$ID\",\"timeoutMinutes\":5}"
curl -s -b /tmp/admin.jar http://localhost:3000/api/admin/state
kill %1
```

Expected: `HTTP/1.1 401` for unauthenticated; approve returns `{"code":{"code":"XXXXXXXX","status":"active","expiresAt":...}}`; state shows the approved request and the active code.

- [ ] **Step 8: Commit**

```bash
git add app/app/api/admin
git commit -m "feat: admin API (state, approve, deny, revoke, delete) guarded by session"
```

---

### Task 11: Validate route (signed grant token)

**Files:**
- Create: `app/app/api/validate/route.ts`

- [ ] **Step 1: Write `app/app/api/validate/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getRedis } from '../../../lib/redis';
import { getCode, resolveCode } from '../../../lib/store';
import { signGrant } from '../../../lib/grant';

export async function POST(req: Request) {
  const privateKey = process.env.SIGNING_PRIVATE_KEY;
  if (!privateKey) {
    return NextResponse.json(
      { error: { code: 'not_configured', message: 'SIGNING_PRIVATE_KEY is not set' } },
      { status: 500 },
    );
  }
  const body = await req.json().catch(() => null);
  const raw = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!raw) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'code required' } },
      { status: 400 },
    );
  }

  const redis = getRedis();
  const record = await getCode(redis, raw);
  if (!record) {
    return NextResponse.json({ reason: 'unknown' }, { status: 401 });
  }

  const now = Date.now();
  // Lazy expiration is enforced (and persisted) here, server-side.
  const resolved = await resolveCode(redis, record, now);
  if (resolved.status !== 'active') {
    return NextResponse.json({ reason: resolved.status }, { status: 401 });
  }

  const token = signGrant(
    { name: resolved.name, code: resolved.code, issuedAt: now, expiresAt: resolved.expiresAt },
    privateKey,
  );
  return NextResponse.json({ token, name: resolved.name, expiresAt: resolved.expiresAt });
}
```

- [ ] **Step 2: Verify happy path, revocation, and signature with curl + node**

```bash
cd app && npx next dev --port 3000 &
sleep 5
# unknown code
curl -si -X POST http://localhost:3000/api/validate -H 'Content-Type: application/json' -d '{"code":"NOPENOPE"}' | head -1
# approve a fresh request (reuse admin jar from Task 10 or re-login), then validate
PASS=$(grep ADMIN_PASSWORD .env.local | cut -d= -f2)
curl -s -c /tmp/admin.jar -X POST http://localhost:3000/api/admin/login -H 'Content-Type: application/json' -d "{\"password\":\"$PASS\"}" > /dev/null
curl -s -X POST http://localhost:3000/api/requests -H 'Content-Type: application/json' -b 'cookieId=validate-test' -d '{"name":"Val"}' > /dev/null
ID=$(curl -s http://localhost:3000/api/requests -b 'cookieId=validate-test' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).requests[0].id))')
CODE=$(curl -s -b /tmp/admin.jar -X POST http://localhost:3000/api/admin/approve -H 'Content-Type: application/json' -d "{\"requestId\":\"$ID\",\"timeoutMinutes\":5}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).code.code))')
TOKEN=$(curl -s -X POST http://localhost:3000/api/validate -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).token))')
# verify the signature offline against the committed public key
node -e "
const { verify, createPublicKey } = require('node:crypto');
const fs = require('fs');
const pub = fs.readFileSync('../shared/signing-public-key.b64', 'utf8').trim();
const [body, sig] = process.argv[1].split('.');
const key = createPublicKey({ key: Buffer.from(pub, 'base64'), format: 'der', type: 'spki' });
const ok = verify(null, Buffer.from(body, 'base64url'), key, Buffer.from(sig, 'base64url'));
console.log('signature valid:', ok);
console.log('payload:', Buffer.from(body, 'base64url').toString());
" "$TOKEN"
# revoke, then validate again
curl -s -b /tmp/admin.jar -X POST http://localhost:3000/api/admin/revoke -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}" > /dev/null
curl -s -X POST http://localhost:3000/api/validate -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}"
kill %1
```

Expected: unknown → `HTTP/1.1 401`; valid → `signature valid: true` with a JSON payload containing name/code/issuedAt/expiresAt; after revoke → `{"reason":"revoked"}` (401).

- [ ] **Step 3: Commit**

```bash
git add app/app/api/validate
git commit -m "feat: /api/validate issues Ed25519-signed grant tokens with lazy expiry"
```

---

### Task 12: install.sh stub, version, bundle plumbing

**Files:**
- Modify: `app/scripts/make-bundle.mjs` (replace stub from Task 3)
- Create: `app/app/install.sh/route.ts`, `app/app/api/version/route.ts`, `app/app/api/bundle/route.ts`

- [ ] **Step 1: Replace `app/scripts/make-bundle.mjs`** — runs at build time so Vercel functions never need runtime fs access to `../cli`

```js
// Prebuild: tar ../cli and ../interface into public/bundle.tar.gz so
// /api/bundle can serve them as a static asset. Runs on every dev/build.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '..');
const out = path.join(appDir, 'public', 'bundle.tar.gz');

mkdirSync(path.join(appDir, 'public'), { recursive: true });
execSync(`tar -czf "${out}" cli interface`, { cwd: repoRoot, stdio: 'inherit' });
console.log(`bundle written: ${out}`);
```

- [ ] **Step 2: Write `app/app/install.sh/route.ts`** (stub; stage 2 fills the real installer)

```ts
import config from '../../../template.config.json';

export async function GET() {
  const script = `#!/bin/bash
# ${config.brandName} installer
# Stage 2 replaces this stub with the real installer for the "${config.commandName}" command.
echo "installer placeholder"
`;
  return new Response(script, {
    headers: { 'Content-Type': 'text/x-shellscript; charset=utf-8' },
  });
}
```

- [ ] **Step 3: Write `app/app/api/version/route.ts`** (version baked in at build from `cli/package.json`)

```ts
import cliPkg from '../../../../cli/package.json';

export async function GET() {
  return Response.json({ version: cliPkg.version });
}
```

- [ ] **Step 4: Write `app/app/api/bundle/route.ts`**

```ts
import { NextResponse } from 'next/server';

// The tarball is produced by scripts/make-bundle.mjs during prebuild and
// served from /public as a static asset; this route is the stable API path.
export async function GET(req: Request) {
  return NextResponse.redirect(new URL('/bundle.tar.gz', req.url));
}
```

- [ ] **Step 5: Verify all three endpoints**

```bash
cd app && npm run dev -- --port 3000 &
sleep 6
curl -fsSL http://localhost:3000/install.sh | bash
curl -s http://localhost:3000/api/version
curl -sL http://localhost:3000/api/bundle -o /tmp/bundle.tar.gz && tar -tzf /tmp/bundle.tar.gz
kill %1
```

Expected: `installer placeholder`; `{"version":"0.1.0"}`; tar listing shows `cli/package.json`, `cli/index.mjs`, `interface/index.html`.

- [ ] **Step 6: Commit**

```bash
git add app/scripts/make-bundle.mjs app/app/install.sh app/app/api/version app/app/api/bundle
git commit -m "feat: install.sh stub, /api/version, /api/bundle build-time tarball"
```

---

### Task 13: Shared Countdown component (TDD on formatting)

**Files:**
- Create: `app/app/components/Countdown.tsx`
- Test: `app/tests/countdown-format.test.ts`

- [ ] **Step 1: Write failing tests `app/tests/countdown-format.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { formatRemaining } from '../app/components/Countdown';

describe('formatRemaining', () => {
  it('formats minutes and seconds', () => {
    expect(formatRemaining(5 * 60_000)).toBe('5:00');
    expect(formatRemaining(61_000)).toBe('1:01');
    expect(formatRemaining(9_000)).toBe('0:09');
  });
  it('includes hours when >= 1h', () => {
    expect(formatRemaining(3_600_000)).toBe('1:00:00');
    expect(formatRemaining(2 * 3_600_000 + 5 * 60_000 + 3_000)).toBe('2:05:03');
  });
  it('shows expired at or below zero', () => {
    expect(formatRemaining(0)).toBe('expired');
    expect(formatRemaining(-1)).toBe('expired');
    expect(formatRemaining(500)).toBe('0:01'); // sub-second remainder rounds up
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/countdown-format.test.ts`
Expected: FAIL — cannot resolve `../app/components/Countdown`.

- [ ] **Step 3: Write `app/app/components/Countdown.tsx`** — the ONE timer used by both landing and admin

```tsx
'use client';

import { useEffect, useState } from 'react';

export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalSeconds = Math.ceil(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Accuracy: remaining time is always derived from the absolute expiresAt
// timestamp, so setInterval drift can never accumulate into a wrong display.
export default function Countdown({
  expiresAt,
  onExpire,
}: {
  expiresAt: number;
  onExpire?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const expired = expiresAt - now <= 0;
  useEffect(() => {
    if (expired) onExpire?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  return <span>{formatRemaining(expiresAt - now)}</span>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/countdown-format.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/app/components/Countdown.tsx app/tests/countdown-format.test.ts
git commit -m "feat: shared drift-proof Countdown component"
```

---

### Task 14: Landing page

**Files:**
- Modify: `app/app/page.tsx` (replace Task 3 stub entirely)

- [ ] **Step 1: Write `app/app/page.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Countdown from './components/Countdown';
import config from '../../template.config.json';

interface GrantedCode {
  code: string;
  expiresAt: number;
  status: 'active' | 'expired' | 'revoked';
  timeoutMinutes: number;
}

interface MyRequest {
  id: string;
  name: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: number;
  grantedCode: GrantedCode | null;
}

export default function Home() {
  const [name, setName] = useState('');
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/requests');
    if (res.ok) setRequests((await res.json()).requests);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    setName('');
    setSubmitting(false);
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/requests/${id}`, { method: 'DELETE' });
    load();
  }

  const installCmd = `curl -fsSL ${config.vercelUrl}/install.sh | bash`;

  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>{config.brandName}</h1>

      <section>
        <h2>Request access</h2>
        <form onSubmit={submit}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={100}
            required
          />{' '}
          <button type="submit" disabled={submitting}>Request code</button>
        </form>
      </section>

      <section>
        <h2>Install</h2>
        <p>
          <code>{installCmd}</code>{' '}
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(installCmd);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </p>
      </section>

      <section>
        <h2>My requests</h2>
        {requests.length === 0 ? (
          <p>No requests yet.</p>
        ) : (
          <ul>
            {requests.map((r) => (
              <li key={r.id} style={{ marginBottom: '0.5rem' }}>
                <strong>{r.name}</strong>
                {' — '}
                {r.grantedCode ? r.grantedCode.status : r.status}
                {r.grantedCode?.status === 'active' && (
                  <>
                    {' — code: '}
                    <code>{r.grantedCode.code}</code>
                    {' — expires in '}
                    <Countdown expiresAt={r.grantedCode.expiresAt} onExpire={load} />
                  </>
                )}{' '}
                <button onClick={() => remove(r.id)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Verify in the browser**

Run: `cd app && npm run dev -- --port 3000`, open `http://localhost:3000`.
Check: brand heading reads "Open Interface"; submitting a name shows it as `pending`; the curl command shows the `vercelUrl` from config and the Copy button copies it; Delete removes the entry. Approve it via curl (Task 10 commands) and refresh: status becomes the code status with a ticking countdown. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add app/app/page.tsx
git commit -m "feat: landing page (request form, live code list, install command)"
```

---

### Task 15: Admin page

**Files:**
- Create: `app/app/admin/page.tsx`

- [ ] **Step 1: Write `app/app/admin/page.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Countdown from '../components/Countdown';

interface AdminRequest {
  id: string;
  name: string;
  cookieId: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: number;
}

interface AdminCode {
  code: string;
  requestId: string;
  name: string;
  timeoutMinutes: number;
  approvedAt: number;
  expiresAt: number;
  status: 'active' | 'expired' | 'revoked';
}

async function post(url: string, body: unknown) {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function PendingRow({ req, onDone }: { req: AdminRequest; onDone: () => void }) {
  const [minutes, setMinutes] = useState(60);
  return (
    <tr>
      <td>{req.name}</td>
      <td>{new Date(req.createdAt).toLocaleString()}</td>
      <td>
        <input
          type="number"
          min={1}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          style={{ width: '5em' }}
        />{' '}
        min{' '}
        <button
          onClick={async () => {
            await post('/api/admin/approve', { requestId: req.id, timeoutMinutes: minutes });
            onDone();
          }}
        >
          Approve
        </button>{' '}
        <button
          onClick={async () => {
            await post('/api/admin/deny', { requestId: req.id });
            onDone();
          }}
        >
          Deny
        </button>
      </td>
    </tr>
  );
}

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<{ requests: AdminRequest[]; codes: AdminCode[] } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/state');
    if (res.status === 401) {
      setNeedsLogin(true);
      setState(null);
      return;
    }
    if (res.ok) {
      setNeedsLogin(false);
      setState(await res.json());
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setPassword('');
      setError('');
      load();
    } else {
      setError('Wrong password');
    }
  }

  async function del(url: string) {
    await fetch(url, { method: 'DELETE' });
    load();
  }

  const wrap = { maxWidth: 800, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' } as const;

  if (needsLogin) {
    return (
      <main style={wrap}>
        <h1>Admin login</h1>
        <form onSubmit={login}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
          />{' '}
          <button type="submit">Log in</button>
        </form>
        {error && <p>{error}</p>}
      </main>
    );
  }

  if (!state) return <main style={wrap}>Loading…</main>;

  const pending = state.requests.filter((r) => r.status === 'pending');
  const deniedRequests = state.requests.filter((r) => r.status === 'denied');
  const activeCodes = state.codes.filter((c) => c.status === 'active');
  const pastCodes = state.codes.filter((c) => c.status !== 'active');

  return (
    <main style={wrap}>
      <h1>Admin</h1>

      <section>
        <h2>Pending requests</h2>
        {pending.length === 0 ? (
          <p>None.</p>
        ) : (
          <table border={1} cellPadding={6}>
            <thead>
              <tr><th>Name</th><th>Requested</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <PendingRow key={r.id} req={r} onDone={load} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Active codes</h2>
        {activeCodes.length === 0 ? (
          <p>None.</p>
        ) : (
          <table border={1} cellPadding={6}>
            <thead>
              <tr><th>Name</th><th>Code</th><th>Expires in</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {activeCodes.map((c) => (
                <tr key={c.code}>
                  <td>{c.name}</td>
                  <td><code>{c.code}</code></td>
                  <td><Countdown expiresAt={c.expiresAt} onExpire={load} /></td>
                  <td>
                    <button
                      onClick={async () => {
                        await post('/api/admin/revoke', { code: c.code });
                        load();
                      }}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Past codes</h2>
        {pastCodes.length === 0 ? (
          <p>None.</p>
        ) : (
          <table border={1} cellPadding={6}>
            <thead>
              <tr><th>Name</th><th>Code</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {pastCodes.map((c) => (
                <tr key={c.code}>
                  <td>{c.name}</td>
                  <td><code>{c.code}</code></td>
                  <td>{c.status}</td>
                  <td>
                    <button onClick={() => del(`/api/admin/codes/${c.code}`)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Denied requests</h2>
        {deniedRequests.length === 0 ? (
          <p>None.</p>
        ) : (
          <table border={1} cellPadding={6}>
            <thead>
              <tr><th>Name</th><th>Requested</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {deniedRequests.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td>
                    <button onClick={() => del(`/api/admin/requests/${r.id}`)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Verify in the browser**

Run: `cd app && npm run dev -- --port 3000`, open `http://localhost:3000/admin`.
Check: password prompt appears; wrong password shows "Wrong password"; correct password shows the dashboard. Create a request on `/`, refresh admin, approve with 2 minutes: code appears under Active codes with a ticking countdown. Revoke it: moves to Past codes; Delete removes it. Approve another with 1 minute and wait it out: after expiry, revisiting/refreshing shows it under Past codes as `expired` (lazy expiration). Stop the server.

- [ ] **Step 3: Commit**

```bash
git add app/app/admin
git commit -m "feat: admin dashboard (approve/deny, live code timers, revoke, cleanup)"
```

---

### Task 16: Full test run, end-to-end pass, README

**Files:**
- Create: `README.md`
- Create: `docs/superpowers/plans/2026-07-02-openinterface-stage1.md` (copy of this plan, if not already saved)

- [ ] **Step 1: Run the whole test suite**

Run: `cd app && npx vitest run`
Expected: PASS — all suites (smoke, lifecycle, grant, store, admin-auth, countdown-format), 25 tests total.

- [ ] **Step 2: Production build check**

Run: `cd app && npm run build`
Expected: prebuild writes `public/bundle.tar.gz`, `next build` succeeds with all routes listed (`/`, `/admin`, `/api/*`, `/install.sh`).

- [ ] **Step 3: Full lifecycle E2E in the browser** (one pass over everything)

1. `npm run dev`, open `/`, request access as "E2E".
2. Open `/admin`, log in, approve "E2E" with 2 minutes.
3. Back on `/`: code visible with live countdown ticking every second; verify the same remaining time (±1s) shows on `/admin`.
4. `curl -s -X POST localhost:3000/api/validate -d '{"code":"<CODE>"}' -H 'Content-Type: application/json'` → token returned.
5. Revoke on `/admin` → validate again → `{"reason":"revoked"}`.
6. Delete everything from both pages; both lists empty.

- [ ] **Step 4: Write `README.md`**

```markdown
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
```

- [ ] **Step 5: Final commit**

```bash
git add README.md docs
git commit -m "docs: README with env setup, local dev, and Vercel deploy instructions"
```

---

## Verification (overall)

- **Unit:** `cd app && npx vitest run` — lifecycle, grant signing, store (incl. lazy expiry + cascade delete), admin auth, timer formatting all green.
- **Build:** `cd app && npm run build` succeeds and produces `public/bundle.tar.gz`.
- **E2E:** Task 16 Step 3 browser pass covers the full lifecycle: pending → approved/active (live countdown on both pages) → validate (signed token, offline-verifiable) → revoke/expire → 401 with reason → delete.
- **Security checks:** admin mutations without session → 401; DELETE of another cookie's request → 404; tampered grant token fails offline verification (unit-tested).

## Notes & known uncertainties (honest per spec)

- **Vercel "include files outside root directory":** the bundle build reads `../cli`/`../interface` at build time. I believe Vercel has a setting for this when Root Directory is set, but I'm not certain of its current name/availability — flagged in the README rather than invented.
- **Upstash local emulator:** none is assumed; local dev uses a real (free-tier) Upstash database. Unit tests don't need Redis at all (FakeRedis).
- `GET /api/requests?cookieId=` is supported as a fallback per spec, but the httpOnly-adjacent cookie value is authoritative when present. Knowing someone's random UUID cookieId is treated as equivalent to being them — acceptable for this anonymous, low-stakes flow.
- Version numbers (`next@^15.3`, `vitest@^3`) are current-major pins; if npm resolves newer compatible versions, that's expected.
