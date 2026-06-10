import { describe, it, expect } from 'vitest';
import {
  buildClearCookie,
  buildSessionCookie,
  SESSION_COOKIE_NAME,
  signSession,
  verifySession,
  type SessionPayload,
} from '../session';

const SECRET = 'test-session-secret';
const ALT_SECRET = 'a-different-secret';

const PAYLOAD: Omit<SessionPayload, 'iat' | 'exp'> = {
  userId: 'u1',
  email: 'admin@example.com',
  role: 'admin',
};

describe('signSession / verifySession', () => {
  it('roundtrips a valid session', () => {
    const cookie = signSession(PAYLOAD, SECRET);
    const verified = verifySession(cookie, SECRET);
    expect(verified.ok).toBe(true);
    expect(verified.payload?.userId).toBe('u1');
    expect(verified.payload?.role).toBe('admin');
  });

  it('rejects an empty / missing cookie', () => {
    expect(verifySession(null, SECRET)).toEqual({ ok: false, reason: 'missing' });
    expect(verifySession('', SECRET)).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects a malformed cookie (no dot)', () => {
    expect(verifySession('justbody', SECRET)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a tampered body', () => {
    const cookie = signSession(PAYLOAD, SECRET);
    const [body, sig] = cookie.split('.');
    const tampered = `${body}AAAA.${sig}`;
    expect(verifySession(tampered, SECRET)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejects a signature minted with a different secret', () => {
    const cookie = signSession(PAYLOAD, SECRET);
    expect(verifySession(cookie, ALT_SECRET)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejects an expired session', () => {
    const past = new Date('2020-01-01T00:00:00Z');
    const cookie = signSession(PAYLOAD, SECRET, { now: past, ttlSeconds: 1 });
    expect(verifySession(cookie, SECRET)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a malformed payload (missing fields after decode)', () => {
    // Hand-craft a body without the userId, then sign it.
    const body = Buffer.from(JSON.stringify({ iat: 1, exp: 9999999999 }), 'utf8').toString('base64url');
    const sig = signSession(PAYLOAD, SECRET).split('.')[1]; // unrelated sig
    expect(verifySession(`${body}.${sig}`, SECRET)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('throws when signing with an empty secret', () => {
    expect(() => signSession(PAYLOAD, '')).toThrowError(/secret/);
  });
});

describe('buildSessionCookie / buildClearCookie', () => {
  it('uses HttpOnly + SameSite=Lax + path=/', () => {
    const c = buildSessionCookie('value-here');
    expect(c.name).toBe(SESSION_COOKIE_NAME);
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('lax');
    expect(c.path).toBe('/');
  });

  it('honours an explicit ttlSeconds', () => {
    const c = buildSessionCookie('v', { ttlSeconds: 60 });
    expect(c.maxAge).toBe(60);
  });

  it('clear cookie has maxAge:0 and an empty value', () => {
    const c = buildClearCookie();
    expect(c.value).toBe('');
    expect(c.maxAge).toBe(0);
  });

  it('respects the explicit secure override', () => {
    expect(buildSessionCookie('v', { secure: true }).secure).toBe(true);
    expect(buildSessionCookie('v', { secure: false }).secure).toBe(false);
  });
});
