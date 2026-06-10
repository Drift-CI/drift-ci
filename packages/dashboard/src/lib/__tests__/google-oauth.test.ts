import { describe, it, expect, vi } from 'vitest';

import {
  buildGoogleAuthorizeUrl,
  exchangeGoogleCodeForToken,
  fetchGoogleUser,
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  mintOAuthState,
  verifyOAuthState,
} from '../google-oauth';

const SECRET = 'google-oauth-test-secret';

// ─── re-exported state helpers (sanity check) ──────────────────────────

describe('mintOAuthState / verifyOAuthState (re-exported)', () => {
  it('round-trips a state minted via the google-oauth module', () => {
    const minted = mintOAuthState(SECRET);
    expect(verifyOAuthState(minted.cookieValue, minted.raw, SECRET)).toEqual({
      ok: true,
    });
  });

  it('shares the cookie name with the GitHub flow (mutual exclusion in the browser)', async () => {
    const { OAUTH_STATE_COOKIE: googleCookieName } = await import(
      '../google-oauth'
    );
    const { OAUTH_STATE_COOKIE: githubCookieName } = await import('../oauth');
    expect(googleCookieName).toBe(githubCookieName);
  });
});

// ─── buildGoogleAuthorizeUrl ───────────────────────────────────────────

describe('buildGoogleAuthorizeUrl', () => {
  it('targets the v2 authorize endpoint', () => {
    const url = buildGoogleAuthorizeUrl({
      clientId: 'gci',
      redirectUri: 'https://drift.example.com/login/google/callback',
      state: 'state-x',
    });
    expect(url.startsWith(GOOGLE_AUTHORIZE_URL)).toBe(true);
  });

  it('threads client_id, redirect_uri, state, response_type, and scope', () => {
    const url = new URL(
      buildGoogleAuthorizeUrl({
        clientId: 'gci',
        redirectUri: 'https://drift.example.com/login/google/callback',
        state: 's',
      }),
    );
    expect(url.searchParams.get('client_id')).toBe('gci');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://drift.example.com/login/google/callback',
    );
    expect(url.searchParams.get('state')).toBe('s');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });

  it('honours a custom scope override', () => {
    const url = new URL(
      buildGoogleAuthorizeUrl({
        clientId: 'gci',
        redirectUri: 'https://x.example.com/cb',
        state: 's',
        scope: 'openid email',
      }),
    );
    expect(url.searchParams.get('scope')).toBe('openid email');
  });
});

// ─── exchangeGoogleCodeForToken ────────────────────────────────────────

describe('exchangeGoogleCodeForToken', () => {
  it('POSTs form-encoded body with grant_type=authorization_code', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          access_token: 'ya29.test',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'openid email profile',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const out = await exchangeGoogleCodeForToken({
      clientId: 'gci',
      clientSecret: 'gcs',
      code: 'abc',
      redirectUri: 'https://drift.example.com/cb',
      fetch: fakeFetch,
    });

    expect(calls[0].url).toBe(GOOGLE_TOKEN_URL);
    expect(calls[0].init?.method).toBe('POST');
    const body = (calls[0].init?.body as string) ?? '';
    const params = new URLSearchParams(body);
    expect(params.get('client_id')).toBe('gci');
    expect(params.get('client_secret')).toBe('gcs');
    expect(params.get('code')).toBe('abc');
    expect(params.get('redirect_uri')).toBe('https://drift.example.com/cb');
    expect(params.get('grant_type')).toBe('authorization_code');

    expect(out).toEqual({
      accessToken: 'ya29.test',
      expiresIn: 3600,
      scope: 'openid email profile',
      tokenType: 'Bearer',
    });
  });

  it('throws when Google reports a top-level `error` field', async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'expired' }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    await expect(
      exchangeGoogleCodeForToken({
        clientId: 'gci',
        clientSecret: 'gcs',
        code: 'abc',
        redirectUri: 'https://x.example.com/cb',
        fetch: fakeFetch,
      }),
    ).rejects.toThrow(/invalid_grant.*expired/);
  });

  it('throws when access_token is missing from a 2xx response', async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(
      exchangeGoogleCodeForToken({
        clientId: 'gci',
        clientSecret: 'gcs',
        code: 'abc',
        redirectUri: 'https://x.example.com/cb',
        fetch: fakeFetch,
      }),
    ).rejects.toThrow(/no access_token/);
  });

  it('throws on non-2xx HTTP status', async () => {
    const fakeFetch = vi.fn(async () =>
      new Response('forbidden', { status: 403 }),
    ) as unknown as typeof fetch;
    await expect(
      exchangeGoogleCodeForToken({
        clientId: 'gci',
        clientSecret: 'gcs',
        code: 'abc',
        redirectUri: 'https://x.example.com/cb',
        fetch: fakeFetch,
      }),
    ).rejects.toThrow(/403/);
  });
});

// ─── fetchGoogleUser ───────────────────────────────────────────────────

describe('fetchGoogleUser', () => {
  function makeFetch(body: unknown, status = 200): typeof fetch {
    return vi.fn(
      async () => new Response(JSON.stringify(body), { status }),
    ) as unknown as typeof fetch;
  }

  it('GETs /userinfo with the Bearer token', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          sub: '1234567890',
          email: 'user@example.com',
          email_verified: true,
          name: 'Test User',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await fetchGoogleUser('ya29.test', fakeFetch);
    expect(calls[0].url).toBe(GOOGLE_USERINFO_URL);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ya29.test');
  });

  it('returns the user when email_verified is true', async () => {
    const out = await fetchGoogleUser(
      't',
      makeFetch({
        sub: '1234567890',
        email: 'user@example.com',
        email_verified: true,
        name: 'Test User',
      }),
    );
    expect(out).toEqual({
      id: '1234567890',
      email: 'user@example.com',
      name: 'Test User',
    });
  });

  it('returns name=null when Google omits name', async () => {
    const out = await fetchGoogleUser(
      't',
      makeFetch({
        sub: 'abc',
        email: 'u@e.com',
        email_verified: true,
      }),
    );
    expect(out.name).toBeNull();
  });

  it('rejects when email_verified is false (drift-ci requires a verified email)', async () => {
    await expect(
      fetchGoogleUser(
        't',
        makeFetch({
          sub: 'abc',
          email: 'u@e.com',
          email_verified: false,
        }),
      ),
    ).rejects.toThrow(/not verified/);
  });

  it('rejects when email_verified is missing entirely', async () => {
    await expect(
      fetchGoogleUser('t', makeFetch({ sub: 'abc', email: 'u@e.com' })),
    ).rejects.toThrow(/not verified/);
  });

  it('rejects when sub is missing', async () => {
    await expect(
      fetchGoogleUser(
        't',
        makeFetch({ email: 'u@e.com', email_verified: true }),
      ),
    ).rejects.toThrow(/no `sub`/);
  });

  it('rejects when email is missing', async () => {
    await expect(
      fetchGoogleUser('t', makeFetch({ sub: 'abc', email_verified: true })),
    ).rejects.toThrow(/no email/);
  });

  it('throws on a non-2xx /userinfo response', async () => {
    await expect(
      fetchGoogleUser('t', makeFetch({}, 401)),
    ).rejects.toThrow(/401/);
  });
});
