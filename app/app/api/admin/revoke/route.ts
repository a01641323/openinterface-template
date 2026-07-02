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
