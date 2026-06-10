import Link from 'next/link';
import type { JSX } from 'react';

import { signInAction } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({
  searchParams,
}: PageProps): Promise<JSX.Element> {
  const { next, error } = await searchParams;
  const githubEnabled = Boolean(process.env.GITHUB_OAUTH_CLIENT_ID);
  const googleEnabled = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID);
  const passwordEnabled = Boolean(process.env.DRIFT_DASHBOARD_PASSWORD);
  const anyOauth = githubEnabled || googleEnabled;

  const banner = pickBanner(error);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <header className="mb-6 flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <span aria-hidden>🌊</span>
          <span>drift-ci</span>
        </header>
        <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
          Sign in to view runs, drift timelines, and case diffs.
        </p>

        {banner ? (
          <div
            role="alert"
            className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200"
          >
            {banner}
          </div>
        ) : null}

        {githubEnabled ? (
          <Link
            href={`/login/github${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <GithubGlyph />
            Sign in with GitHub
          </Link>
        ) : null}

        {googleEnabled ? (
          <Link
            href={`/login/google${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            <GoogleGlyph />
            Sign in with Google
          </Link>
        ) : null}

        {anyOauth && passwordEnabled ? (
          <div className="my-4 flex items-center gap-3 text-xs text-neutral-400 dark:text-neutral-500">
            <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            <span>or</span>
            <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
          </div>
        ) : null}

        {passwordEnabled ? (
          <form action={signInAction} className="space-y-4">
            <input type="hidden" name="next" value={next ?? '/'} />
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Dashboard password
              </span>
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
                autoFocus={!anyOauth}
                className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-neutral-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
            </label>
            <button
              type="submit"
              className={`w-full rounded-md px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 ${
                anyOauth
                  ? 'border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200'
              }`}
            >
              Sign in with password
            </button>
          </form>
        ) : null}

        {!passwordEnabled && !anyOauth ? (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            No sign-in method is configured. Set one of:{' '}
            <code className="font-mono text-xs">DRIFT_DASHBOARD_PASSWORD</code>,{' '}
            <code className="font-mono text-xs">GITHUB_OAUTH_CLIENT_ID</code>/
            <code className="font-mono text-xs">…_SECRET</code>, or{' '}
            <code className="font-mono text-xs">GOOGLE_OAUTH_CLIENT_ID</code>/
            <code className="font-mono text-xs">…_SECRET</code> on the server.
          </p>
        ) : null}

        <p className="mt-6 text-xs text-neutral-500 dark:text-neutral-400">
          Sessions are signed with{' '}
          <code className="font-mono">DRIFT_SESSION_SECRET</code>. Rotate it to
          invalidate every active sign-in.
        </p>
      </div>
    </main>
  );
}

function GoogleGlyph(): JSX.Element {
  // The official 4-colour "G" mark.
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.96h5.5c-.24 1.32-1.7 3.84-5.5 3.84-3.32 0-6.02-2.74-6.02-6.12s2.7-6.12 6.02-6.12c1.88 0 3.16.8 3.88 1.5l2.66-2.56C16.92 2.94 14.7 2 12 2 6.86 2 2.7 6.16 2.7 11.3S6.86 20.6 12 20.6c6.08 0 9.62-4.26 9.62-10.26 0-.7-.08-1.22-.18-1.74H12z"
      />
      <path
        fill="#4285F4"
        d="M21.62 8.6h-9.62v3.96h5.5c-.24 1.32-1.7 3.84-5.5 3.84v3.46c2.94 0 5.4-.96 7.2-2.62 1.84-1.7 2.6-4.18 2.6-6.62 0-.7-.08-1.22-.18-1.74-.04-.16-.08-.3-.08-.3z"
      />
    </svg>
  );
}

function GithubGlyph(): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

function pickBanner(error: string | undefined): string | null {
  switch (error) {
    case 'bad-password':
      return 'That password is not correct.';
    case 'rate-limited':
      return 'Too many sign-in attempts. Wait a minute and try again.';
    case 'not-configured':
      return 'This dashboard isn\'t fully configured yet — set DRIFT_DASHBOARD_PASSWORD and DRIFT_SESSION_SECRET on the server.';
    case 'no-admin':
      return 'No admin user has been seeded yet. Set DRIFT_ADMIN_EMAIL on the server and restart so the migrations can create one.';
    case 'oauth-not-configured':
      return 'OAuth sign-in isn\'t configured. Set GITHUB_OAUTH_* or GOOGLE_OAUTH_* on the server.';
    case 'oauth-malformed-callback':
      return 'OAuth returned a malformed callback. Try signing in again.';
    case 'oauth-state-mismatch':
    case 'oauth-state-malformed':
    case 'oauth-state-bad-signature':
    case 'oauth-state-expired':
      return 'The OAuth sign-in token couldn\'t be verified. Start the flow again.';
    case 'oauth-token-exchange':
      return 'Couldn\'t exchange the OAuth authorisation code. Check the OAuth app settings.';
    case 'oauth-user-fetch':
      return 'Signed in but couldn\'t read your profile. Make sure the requested scopes are granted (and your email is verified for Google).';
    case 'oauth-no-matching-user':
      return 'Your verified email isn\'t in the drift-ci users table. Ask an admin to add you (or set DRIFT_ADMIN_EMAIL to your address).';
    /* c8 ignore next 2 */
    default:
      return null;
  }
}
