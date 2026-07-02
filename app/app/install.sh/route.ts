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
