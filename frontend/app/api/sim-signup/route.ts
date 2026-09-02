/**
 * Stand-in for a publisher's own backend: it holds the API key and calls the Partner API
 * server-side when a new user finishes signing up inside the publisher's app.
 */
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
  const { install_referrer, publisher_user_ref, api_key, identified, confirm_id, platform, code } =
    await req.json();
  if (!api_key) return Response.json({ message: 'publisher API key required' }, { status: 400 });

  // Second leg: the user cleared verification, so claim the held-back part of the fee.
  if (confirm_id) return proxy(`/v1/attribution/${confirm_id}/confirm`, api_key);

  // An engagement scan hands the app one thing: an opaque transaction code. It is claimed on
  // the same endpoint, and explicitly — the acquisition inputs below answer a different question.
  if (code) return proxy('/v1/attribution/claim', api_key, { publisher_user_ref, code });


// A real backend reads these from the request it is already serving. The referrer comes from
// Play's Install Referrer API on Android; on iOS there is none.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '127.0.0.1';
  return proxy('/v1/attribution/claim', api_key, {
    publisher_user_ref,
    install_referrer: install_referrer || undefined,
    ip,
    user_agent: req.headers.get('user-agent') ?? '',
    platform,
    identified: identified === true,
  });
}
