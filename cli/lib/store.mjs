import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export const grantPath = (dataDir) => path.join(dataDir, 'grant.json');

export function readGrant(dataDir) {
  try {
    return JSON.parse(readFileSync(grantPath(dataDir), 'utf8'));
  } catch {
    return null;
  }
}

export function writeGrant(dataDir, grant) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(grantPath(dataDir), JSON.stringify(grant));
}

export function deleteGrant(dataDir) {
  rmSync(grantPath(dataDir), { force: true });
}
