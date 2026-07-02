import cliPkg from '../../../../cli/package.json';

export async function GET() {
  return Response.json({ version: cliPkg.version });
}
