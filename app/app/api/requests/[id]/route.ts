import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRedis } from '../../../../lib/redis';
import { getRequest, deleteRequest } from '../../../../lib/store';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const cookieId = cookieStore.get('cookieId')?.value;
  const redis = getRedis();
  const request = await getRequest(redis, id);
  // 404 for both missing and not-owned: don't leak other users' request ids.
  if (!request || !cookieId || request.cookieId !== cookieId) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Request not found' } },
      { status: 404 },
    );
  }
  await deleteRequest(redis, id);
  return NextResponse.json({ ok: true });
}
