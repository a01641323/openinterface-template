#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  config, baseUrl, dataDir, interfaceDir, publicKeyB64, rootDir, localVersion,
} from './lib/config.mjs';
import { createInterfaceServer } from './lib/server.mjs';
import { runUpdate } from './lib/update.mjs';

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];
  try {
    spawn(cmd[0], cmd.slice(1), { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* browser opening is best-effort */
  }
}

const arg = process.argv[2];

if (arg === 'update') {
  await runUpdate({ rootDir, baseUrl, localVersion });
} else if (arg === '--version' || arg === '-v') {
  console.log(localVersion);
} else if (arg === undefined || arg === '--no-open') {
  const server = createInterfaceServer({ config, baseUrl, dataDir, interfaceDir, publicKeyB64 });
  server.listen(config.port, '0.0.0.0', () => {
    const url = `http://localhost:${config.port}`;
    console.log(`${config.brandName} v${localVersion} running at ${url}`);
    if (arg !== '--no-open' && !process.env.NO_OPEN) openBrowser(url);
  });
} else {
  console.log(`Usage: ${config.commandName} [update|--version|--no-open]`);
  process.exitCode = arg === '--help' || arg === 'help' ? 0 : 1;
}
