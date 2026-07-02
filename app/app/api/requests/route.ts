import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRedis } from '../../../lib/redis';
import {
  createRequest, listRequestsByCookie, getCodeForRequest, resolveCode,
} from '../../../lib/store';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'name is required (max 100 chars)' } },
      { status: 400 },
    );
  }
  const cookieStore = await cookies();
  const cookieId = cookieStore.get('cookieId')?.value;
  if (!cookieId) {
    return NextResponse.json(
      { error: { code: 'missing_cookie', message: 'cookieId cookie not set' } },
      { status: 400 },
    );
  }
  const request = await createRequest(getRedis(), name, cookieId);
  return NextResponse.json({ request }, { status: 201 });
}

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const cookieId =
    cookieStore.get('cookieId')?.value ??
    new URL(req.url).searchParams.get('cookieId') ??
    '';
  if (!cookieId) return NextResponse.json({ requests: [] });

  const redis = getRedis();
  const now = Date.now();
  const requests = await listRequestsByCookie(redis, cookieId);
  const withCodes = await Promise.all(
    requests.map(async (r) => {
      const code = await getCodeForRequest(redis, r.id);
      return { ...r, grantedCode: code ? await resolveCode(redis, code, now) : null };
    }),
  );
  return NextResponse.json({ requests: withCodes });
}
