import { NextResponse } from 'next/server';

const isProd = process.env.NODE_ENV === 'production';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
};

export async function POST(req: Request) {
  const { token, org } = await req.json().catch(() => ({}));
  if (!token || !org) return NextResponse.json({ message: 'token and org required' }, { status: 400 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set('token', token, COOKIE_OPTS);
  res.cookies.set('org', JSON.stringify(org), COOKIE_OPTS);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('token');
  res.cookies.delete('org');
  return res;
}
