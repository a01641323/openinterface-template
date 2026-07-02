import { NextResponse } from 'next/server';
import { getRedis } from '../../../lib/redis';
import { getCode, resolveCode } from '../../../lib/store';
import { signGrant } from '../../../lib/grant';

export async function POST(req: Request) {
  const privateKey = process.env.SIGNING_PRIVATE_KEY;
  if (!privateKey) {
    return NextResponse.json(
      { error: { code: 'not_configured', message: 'SIGNING_PRIVATE_KEY is not set' } },
      { status: 500 },
    );
  }
  const body = await req.json().catch(() => null);
  const raw = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!raw) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'code required' } },
      { status: 400 },
    );
  }

  const redis = getRedis();
  const record = await getCode(redis, raw);
  if (!record) {
    return NextResponse.json({ reason: 'unknown' }, { status: 401 });
  }

  const now = Date.now();
  // Lazy expiration is enforced (and persisted) here, server-side.
  const resolved = await resolveCode(redis, record, now);
  if (resolved.status !== 'active') {
    return NextResponse.json({ reason: resolved.status }, { status: 401 });
  }

  const token = signGrant(
    { name: resolved.name, code: resolved.code, issuedAt: now, expiresAt: resolved.expiresAt },
    privateKey,
  );
  return NextResponse.json({ token, name: resolved.name, expiresAt: resolved.expiresAt });
}
