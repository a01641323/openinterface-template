import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  if (req.cookies.get('cookieId')) return NextResponse.next();
  const res = NextResponse.next();
  res.cookies.set('cookieId', crypto.randomUUID(), {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  return res;
}
