import { NextResponse } from 'next/server';

// The tarball is produced by scripts/make-bundle.mjs during prebuild and
// served from /public as a static asset; this route is the stable API path.
export async function GET(req: Request) {
  return NextResponse.redirect(new URL('/bundle.tar.gz', req.url));
}
