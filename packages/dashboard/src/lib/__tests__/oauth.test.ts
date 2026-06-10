import { describe, it, expect, vi } from 'vitest';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchGitHubUser,
  GITHUB_AUTHORIZE_URL,
  GITHUB_TOKEN_URL,
  GITHUB_USER_URL,
  GITHUB_USER_EMAILS_URL,
  mintOAuthState,
  verifyOAuthState,
} from '../oauth';

const SECRET = 'oauth-test-secret';

describe('mintOAuthState / verifyOAuthState', () => {
  it('roundtrips a valid state value', () => {
    const minted = mintOAuthState(SECRET);
    expect(verifyOAuthState(minted.cookieValue, minted.raw, SECRET)).toEqual({
      ok: true,
    });
  });

  it('rejects when the cookie and callback values disagree', () => {
    const a = mintOAuthState(SECRET);
    const b = mintOAuthState(SECRET);
    expect(verifyOAuthState(a.cookieValue, b.raw, SECRET)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects null / empty values', () => {
    expect(verifyOAuthState(null, 'x', SECRET)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyOAuthState('x', null, SECRET)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects malformed states (wrong number of dots)', () => {
    expect(verifyOAuthState('only.two', 'only.two', SECRET)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects a tampered HMAC', () => {
    const minted = mintOAuthState(SECRET);
    const parts = minted.cookieValue.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${'0'.repeat(parts[2].length)}`;
    expect(verifyOAuthState(tampered, tampered, SECRET)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejects a state minted with a different secret', () => {
    const minted = mintOAuthState(SECRET);
    expect(verifyOAuthState(minted.cookieValue, minted.raw, 'other')).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejects a state older than the TTL', () => {
    const minted = mintOAuthState(SECRET, new Date('2026-04-01T00:00:00Z'));
    const later = new Date('2026-04-01T01:00:00Z');
    expect(
      verifyOAuthState(minted.cookieValue, minted.raw, SECRET, later),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('throws when minting with an empty secret', () => {
    expect(() => mintOAuthState('')).toThrowError(/secret/);
  });
});

describe('buildAuthorizeUrl', () => {
  it('includes client_id, redirect_uri, state, scope, allow_signup=false', () => {
    const url = buildAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'https://dash.example/login/github/callback',
      state: 'abc',
    });
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(GITHUB_AUTHORIZE_URL);
    expect(parsed.searchParams.get('client_id')).toBe('cid');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://dash.example/login/github/callback',
    );
    expect(parsed.searchParams.get('state')).toBe('abc');
    expect(parsed.searchParams.get('allow_signup')).toBe('false');
    expect(parsed.searchParams.get('scope')).toBe('read:user user:email');
  });

  it('honours a custom scope', () => {
    const url = buildAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'https://dash.example/cb',
      state: 's',
      scope: 'repo',
    });
    expect(new URL(url).searchParams.get('scope')).toBe('repo');
  });
});

describe('exchangeCodeForToken', () => {
  it('POSTs form-encoded body to GITHUB_TOKEN_URL and returns the access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'gho_abc',
          token_type: 'bearer',
          scope: 'read:user user:email',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const out = await exchangeCodeForToken({
      clientId: 'cid',
      clientSecret: 'csec',
      code: 'github-code',
      redirectUri: 'https://dash.example/cb',
      fetch: fetchMock,
    });
    expect(out).toEqual({
      accessToken: 'gho_abc',
      tokenType: 'bearer',
      scope: 'read:user user:email',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(GITHUB_TOKEN_URL);
    expect((init as RequestInit).method).toBe('POST');
    const body = (init as RequestInit).body as string;
    expect(body).toContain('client_id=cid');
    expect(body).toContain('client_secret=csec');
    expect(body).toContain('code=github-code');
  });

  it('throws on non-2xx responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(
      exchangeCodeForToken({
        clientId: 'cid',
        clientSecret: 'csec',
        code: 'c',
        redirectUri: 'https://dash.example/cb',
        fetch: fetchMock,
      }),
    ).rejects.toThrow(/token exchange failed/);
  });

  it('throws when the response includes an OAuth error code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'bad_verification_code', error_description: 'expired' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(
      exchangeCodeForToken({
        clientId: 'cid',
        clientSecret: 'csec',
        code: 'c',
        redirectUri: 'https://dash.example/cb',
        fetch: fetchMock,
      }),
    ).rejects.toThrow(/bad_verification_code.*expired/);
  });

  it('throws when the response is missing access_token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(
      exchangeCodeForToken({
        clientId: 'cid',
        clientSecret: 'csec',
        code: 'c',
        redirectUri: 'https://dash.example/cb',
        fetch: fetchMock,
      }),
    ).rejects.toThrow(/no access_token/);
  });
});

describe('fetchGitHubUser', () => {
  it('returns the profile when /user has a public email', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 42,
          login: 'octocat',
          email: 'octocat@example.com',
          name: 'Octo Cat',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const out = await fetchGitHubUser('gho_abc', fetchMock);
    expect(out).toEqual({
      id: 42,
      login: 'octocat',
      email: 'octocat@example.com',
      name: 'Octo Cat',
    });
    // Single fetch — no /user/emails lookup needed when /user has the email.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls through to /user/emails when /user.email is null', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === GITHUB_USER_URL) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: 1, login: 'u', email: null, name: null }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (url === GITHUB_USER_EMAILS_URL) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { email: 'unverified@example.com', primary: false, verified: false },
              { email: 'private@example.com', primary: true, verified: true },
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      throw new Error(`unexpected url ${url}`);
    });
    const out = await fetchGitHubUser('gho_abc', fetchMock);
    expect(out.email).toBe('private@example.com');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when /user fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
    await expect(fetchGitHubUser('bad', fetchMock)).rejects.toThrow(/\/user fetch failed/);
  });

  it('throws when no verified primary email is available', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === GITHUB_USER_URL) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: 1, login: 'u', email: null }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    await expect(fetchGitHubUser('gho_abc', fetchMock)).rejects.toThrow(
      /no verified primary email/,
    );
  });

  it('throws when /user returns an unexpected shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ login: 'no-id' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(fetchGitHubUser('gho_abc', fetchMock)).rejects.toThrow(
      /unexpected shape/,
    );
  });
});
