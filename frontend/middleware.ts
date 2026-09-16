import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const orgRaw = req.cookies.get('org')?.value;

  let org: { type?: string } | null = null;
  try {
    org = orgRaw ? JSON.parse(orgRaw) : null;
  } catch {
    org = null;
  }

  if (!token || !org) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  if (org.type === 'admin') {
    const url = req.nextUrl.clone();
    url.pathname = '/admin';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
