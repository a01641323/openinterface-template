#!/usr/bin/env node
// Proves the template claim: renaming the project touches ONLY
// template.config.json. Two parts:
//   1. Static: runtime code contains none of the current config literals.
//   2. Behavioral: a copy of cli/interface/shared with a rewritten config
//      ("opendash") boots and reports the new name/brand/port everywhere.
// Exit 0 = all PASS.
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(path.join(repoRoot, 'template.config.json'), 'utf8'));

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

// ---------- 1. static scan of runtime code ----------
// Docs, tests, dev tooling and the config itself are excluded by design:
// the claim is about runtime behavior, not prose.
const SCAN_DIRS = ['cli', 'interface', 'app/app', 'app/lib', 'app/scripts', 'scripts'];
const SKIP = new Set(['node_modules', '.next', 'verify-template.mjs']);
const literals = [
  config.commandName,
  config.brandName,
  String(config.port),
  new URL(config.vercelUrl).host,
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const violations = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(path.join(repoRoot, dir))) {
    const text = readFileSync(file, 'utf8');
    for (const lit of literals) {
      if (text.includes(lit)) violations.push(`${path.relative(repoRoot, file)}: "${lit}"`);
    }
  }
}
check(violations.length === 0, 'runtime code has no hardcoded config literals', violations.join('; '));

// ---------- 2. behavioral rename test ----------
const RENAMED = {
  commandName: 'opendash',
  brandName: 'Open Dash',
  port: 5321,
  vercelUrl: 'https://opendash.example.com',
};

const tmp = mkdtempSync(path.join(os.tmpdir(), 'template-verify-'));
const dataDir = path.join(tmp, 'data');
try {
  for (const entry of ['cli', 'interface', 'shared']) {
    cpSync(path.join(repoRoot, entry), path.join(tmp, entry), { recursive: true });
  }
  writeFileSync(path.join(tmp, 'template.config.json'), JSON.stringify(RENAMED, null, 2));

  // config module derives everything from its own location + the file above
  const cfg = await import(pathToFileURL(path.join(tmp, 'cli', 'lib', 'config.mjs')).href);
  check(cfg.config.commandName === 'opendash', 'config module picks up new commandName');
  check(cfg.baseUrl === 'https://opendash.example.com', 'baseUrl derives from new vercelUrl');
  const defaultDataDir = path.join(os.homedir(), '.opendash');
  check(
    process.env.CLI_DATA_DIR ? true : cfg.dataDir === defaultDataDir,
    'default data dir follows commandName',
    cfg.dataDir,
  );

  // usage string
  const usage = await new Promise((resolve) => {
    const p = spawn('node', [path.join(tmp, 'cli', 'index.mjs'), '--help'], {
      env: { ...process.env, CLI_DATA_DIR: dataDir },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', () => resolve(out));
  });
  check(usage.includes('opendash'), 'CLI usage line uses new commandName', usage.trim());

  // boot the renamed server and ask it who it is
  const server = spawn('node', [path.join(tmp, 'cli', 'index.mjs'), '--no-open'], {
    env: { ...process.env, CLI_DATA_DIR: dataDir, NO_OPEN: '1' },
  });
  let booted = '';
  server.stdout.on('data', (d) => (booted += d));
  const session = await new Promise((resolve) => {
    let tries = 0;
    const attempt = async () => {
      try {
        resolve(await (await fetch(`http://127.0.0.1:${RENAMED.port}/api/local/session`)).json());
      } catch {
        if (++tries > 40) resolve(null);
        else setTimeout(attempt, 250);
      }
    };
    setTimeout(attempt, 500);
  });
  server.kill();
  check(session !== null, `renamed CLI serves on new port ${RENAMED.port}`);
  check(session?.brandName === 'Open Dash', 'session reports new brandName', JSON.stringify(session));
  check(session?.port === 5321, 'session reports new port');
  check(booted.includes('Open Dash'), 'boot banner uses new brandName', booted.trim());
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll template checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
