import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/require-admin';
import { getRedis } from '../../../../lib/redis';
import { listAllRequests, listAllCodes, resolveCode } from '../../../../lib/store';

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Admin session required' } },
      { status: 401 },
    );
  }
  const redis = getRedis();
  const now = Date.now();
  const [requests, rawCodes] = await Promise.all([listAllRequests(redis), listAllCodes(redis)]);
  const codes = await Promise.all(rawCodes.map((c) => resolveCode(redis, c, now)));
  return NextResponse.json({ requests, codes });
}
