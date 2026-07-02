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
