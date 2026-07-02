import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/require-admin';
import { getRedis } from '../../../../lib/redis';
import { approveRequest } from '../../../../lib/store';

export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Admin session required' } },
      { status: 401 },
    );
  }
  const body = await req.json().catch(() => null);
  const requestId = typeof body?.requestId === 'string' ? body.requestId : '';
  const timeoutMinutes = Number(body?.timeoutMinutes);
  if (!requestId || !Number.isInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 60 * 24 * 30) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'requestId and timeoutMinutes (1..43200) required' } },
      { status: 400 },
    );
  }
  const code = await approveRequest(getRedis(), requestId, timeoutMinutes);
  if (!code) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Request not found or not pending' } },
      { status: 404 },
    );
  }
  return NextResponse.json({ code }, { status: 201 });
}
