// Stand-in for a publisher's own backend: it holds the API key and calls the
// Partner API server-side after creating the new user in its own system.
// Server-side, so it can use the internal service address; falls back to the public one.
const API = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function proxy(path: string, apiKey: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body ?? {}),
  });
  return Response.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function POST(req: Request) {
  const { scan_token, publisher_user_ref, api_key, identified, upgrade_id } = await req.json();
  if (!api_key) return Response.json({ message: 'publisher API key required' }, { status: 400 });

  // Second leg: the user finished verification, so claim the held-back delta.
  if (upgrade_id) return proxy(`/v1/redemptions/${upgrade_id}/upgrade`, api_key);

  // `identified` is the publisher asserting this user cleared its own verification bar.
  return proxy('/v1/redemptions/verify', api_key, {
    scan_token,
    publisher_user_ref,
    identified: identified === true,
  });
}
