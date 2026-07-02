import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/require-admin';
import { getRedis } from '../../../../../lib/redis';
import { deleteRequest } from '../../../../../lib/store';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Admin session required' } },
      { status: 401 },
    );
  }
  const { id } = await params;
  await deleteRequest(getRedis(), id);
  return NextResponse.json({ ok: true });
}
