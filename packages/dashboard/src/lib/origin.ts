/**
 * Same-origin enforcement for state-changing requests that aren't
 * already protected by Bearer-token auth. Server Actions and
 * cookie-authenticated API routes use this; pure-Bearer endpoints
 * (POST /api/v1/runs from CI workflows) bypass it because there's
 * no browser cookie to forge.
 *
 * The check passes when EITHER:
 *   - the `Origin` header is missing AND `Sec-Fetch-Site` is `none`
 *     or `same-origin`, OR
 *   - the `Origin` header host matches the request URL host.
 *
 * Same logic as Next.js's built-in Server Action protection, just
 * exposed for our own routes too.
 */

export type OriginCheckOutcome =
  | { ok: true }
  | { ok: false; reason: 'cross-origin' | 'missing-origin' };

export function checkOrigin(request: Request): OriginCheckOutcome {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { ok: true };
  }

  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');

  if (!origin) {
    if (fetchSite === 'none' || fetchSite === 'same-origin') {
      return { ok: true };
    }
    return { ok: false, reason: 'missing-origin' };
  }

  let originUrl: URL;
  let requestUrl: URL;
  try {
    originUrl = new URL(origin);
    requestUrl = new URL(request.url);
  } catch {
    /* c8 ignore next */
    return { ok: false, reason: 'cross-origin' };
  }

  return originUrl.host === requestUrl.host
    ? { ok: true }
    : { ok: false, reason: 'cross-origin' };
}
