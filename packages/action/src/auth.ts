export type DashboardAuth =
  | { kind: 'token' | 'oidc'; value: string }
  | { kind: 'none'; reason: string };

/**
 * Decide how to authenticate dashboard sync. An explicit token always wins
 * (unchanged behaviour). Otherwise, when a dashboard URL is set and GitHub
 * OIDC is available, request an ID token whose audience is the dashboard origin.
 */
export async function resolveDashboardAuth(o: {
  url?: string;
  token?: string;
  env: NodeJS.ProcessEnv;
  getIDToken: (aud: string) => Promise<string>;
}): Promise<DashboardAuth> {
  if (o.token) return { kind: 'token', value: o.token };
  if (!o.url) return { kind: 'none', reason: 'no dashboard-url' };
  if (!o.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    return {
      kind: 'none',
      reason:
        "dashboard-url is set but there's no dashboard-token, and GitHub OIDC isn't available — add `permissions: id-token: write` to the job (or set dashboard-token)",
    };
  }
  try {
    return { kind: 'oidc', value: await o.getIDToken(new URL(o.url).origin) };
  } catch (e) {
    return {
      kind: 'none',
      reason: `couldn't get a GitHub OIDC token (${e instanceof Error ? e.message : String(e)}) — check \`permissions: id-token: write\``,
    };
  }
}
