import { describe, expect, it, vi } from 'vitest';

import { resolveDashboardAuth } from '../auth.js';

const OIDC_ENV = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example/x' };

describe('resolveDashboardAuth', () => {
  it('prefers an explicit token and never requests OIDC', async () => {
    const getIDToken = vi.fn();
    const r = await resolveDashboardAuth({
      url: 'https://drift-ci.com/api/v1/runs',
      token: 't0k',
      env: OIDC_ENV,
      getIDToken,
    });
    expect(r).toEqual({ kind: 'token', value: 't0k' });
    expect(getIDToken).not.toHaveBeenCalled();
  });

  it('requests an OIDC token with the dashboard origin as audience', async () => {
    const getIDToken = vi.fn().mockResolvedValue('jwt');
    const r = await resolveDashboardAuth({
      url: 'https://drift-ci.com/some/path',
      env: OIDC_ENV,
      getIDToken,
    });
    expect(r).toEqual({ kind: 'oidc', value: 'jwt' });
    expect(getIDToken).toHaveBeenCalledWith('https://drift-ci.com');
  });

  it('returns none with the reason when getIDToken throws', async () => {
    const r = await resolveDashboardAuth({
      url: 'https://drift-ci.com',
      env: OIDC_ENV,
      getIDToken: async () => {
        throw new Error('boom');
      },
    });
    expect(r.kind).toBe('none');
    expect(r.kind === 'none' && r.reason).toMatch(/boom.*id-token: write/);
  });

  it('returns none when there is no url', async () => {
    const r = await resolveDashboardAuth({ env: OIDC_ENV, getIDToken: vi.fn() });
    expect(r).toEqual({ kind: 'none', reason: 'no dashboard-url' });
  });

  it('returns none with guidance when OIDC is unavailable', async () => {
    const getIDToken = vi.fn();
    const r = await resolveDashboardAuth({ url: 'https://drift-ci.com', env: {}, getIDToken });
    expect(r.kind).toBe('none');
    expect(r.kind === 'none' && r.reason).toMatch(/id-token: write/);
    expect(getIDToken).not.toHaveBeenCalled();
  });
});
