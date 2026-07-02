import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/require-admin';
import { getRedis } from '../../../../../lib/redis';
import { deleteCode } from '../../../../../lib/store';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  if (!(await requireAdmin())) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Admin session required' } },
      { status: 401 },
    );
  }
  const { code } = await params;
  await deleteCode(getRedis(), code.toUpperCase());
  return NextResponse.json({ ok: true });
}
