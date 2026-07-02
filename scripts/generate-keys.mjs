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
