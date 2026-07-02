import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, renameSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isNewerVersion } from './versions.mjs';

export async function runUpdate({ rootDir, baseUrl, localVersion }) {
  if (existsSync(path.join(rootDir, '.git'))) {
    console.error('update: refusing to overwrite a git checkout — use git pull instead.');
    process.exitCode = 1;
    return;
  }
  let remote;
  try {
    const res = await fetch(`${baseUrl}/api/version`);
    remote = (await res.json()).version;
  } catch {
    console.error('update: could not reach the server — an internet connection is required.');
    process.exitCode = 1;
    return;
  }
  if (!isNewerVersion(remote, localVersion)) {
    console.log(`Already up to date (v${localVersion}).`);
    return;
  }
  console.log(`Updating v${localVersion} -> v${remote} ...`);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cli-update-'));
  try {
    const res = await fetch(`${baseUrl}/api/bundle`);
    if (!res.ok) throw new Error(`bundle download failed (${res.status})`);
    const tarball = path.join(tmp, 'bundle.tar.gz');
    writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
    execSync(`tar -xzf "${tarball}" -C "${tmp}"`);
    // Swap each top-level entry: current -> .old, new -> current, drop .old.
    // The running process keeps its already-loaded modules, so this is safe.
    for (const entry of ['cli', 'interface', 'shared', 'template.config.json']) {
      const next = path.join(tmp, entry);
      if (!existsSync(next)) continue;
      const cur = path.join(rootDir, entry);
      const old = path.join(rootDir, `.${entry}.old`);
      rmSync(old, { recursive: true, force: true });
      if (existsSync(cur)) renameSync(cur, old);
      renameSync(next, cur);
      rmSync(old, { recursive: true, force: true });
    }
    console.log(`Updated to v${remote}.`);
  } catch (err) {
    console.error(`update failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
