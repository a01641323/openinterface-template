import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/require-admin';
import { getRedis } from '../../../../lib/redis';
import { denyRequest } from '../../../../lib/store';

export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Admin session required' } },
      { status: 401 },
    );
  }
  const body = await req.json().catch(() => null);
  const requestId = typeof body?.requestId === 'string' ? body.requestId : '';
  if (!requestId) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'requestId required' } },
      { status: 400 },
    );
  }
  const denied = await denyRequest(getRedis(), requestId);
  if (!denied) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Request not found or not pending' } },
      { status: 404 },
    );
  }
  return NextResponse.json({ request: denied });
}
