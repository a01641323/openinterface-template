import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Everything resolves relative to this file, so the CLI behaves identically
// in the repo checkout and in ~/.{commandName}/ (the bundle mirrors the layout:
// cli/, interface/, shared/, template.config.json).
const libDir = path.dirname(fileURLToPath(import.meta.url));
export const cliDir = path.resolve(libDir, '..');
export const rootDir = path.resolve(cliDir, '..');

export const config = JSON.parse(readFileSync(path.join(rootDir, 'template.config.json'), 'utf8'));
export const baseUrl = String(config.vercelUrl).replace(/\/+$/, '');
export const interfaceDir = path.join(rootDir, 'interface');
export const publicKeyB64 = readFileSync(
  path.join(rootDir, 'shared', 'signing-public-key.b64'),
  'utf8',
).trim();
export const localVersion = JSON.parse(
  readFileSync(path.join(cliDir, 'package.json'), 'utf8'),
).version;

// CLI_DATA_DIR override keeps automated tests away from the real ~/.{commandName}.
export const dataDir =
  process.env.CLI_DATA_DIR || path.join(os.homedir(), `.${config.commandName}`);
