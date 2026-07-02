import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { adminSessionToken } from '../../../../lib/admin-auth';
import { ADMIN_COOKIE } from '../../../../lib/require-admin';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function POST(req: Request) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return NextResponse.json({ error: { code: 'not_configured', message: 'ADMIN_PASSWORD is not set' } }, { status: 500 });
  }
  const body = await req.json().catch(() => null);
  const attempt = typeof body?.password === 'string' ? body.password : '';
  if (!attempt || !safeEqual(attempt, password)) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Wrong password' } }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminSessionToken(password), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
