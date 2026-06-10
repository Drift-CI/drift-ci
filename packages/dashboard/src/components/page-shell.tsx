import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { signOutAction } from '@/app/login/actions';

interface PageShellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  session?: {
    email: string;
    role: 'admin' | 'member' | 'viewer';
  };
}

export function PageShell({
  title,
  subtitle,
  actions,
  children,
  session,
}: PageShellProps): JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            🌊 <span className="font-medium">drift-ci</span>
          </Link>
          {session ? <SessionMenu session={session} /> : null}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex gap-2">{actions}</div> : null}
        </div>
      </header>
      {children}
    </main>
  );
}

function SessionMenu({
  session,
}: {
  session: NonNullable<PageShellProps['session']>;
}): JSX.Element {
  return (
    <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
      <Link
        href="/compare"
        className="hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        Compare
      </Link>
      {session.role === 'admin' ? (
        <>
          <Link
            href="/admin/alerts"
            className="hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Alerts
          </Link>
          <Link
            href="/admin/tokens"
            className="hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Tokens
          </Link>
          <Link
            href="/admin/audit"
            className="hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Audit
          </Link>
        </>
      ) : null}
      <span className="font-mono" title={`role: ${session.role}`}>
        {session.email}
      </span>
      <form action={signOutAction}>
        <button
          type="submit"
          className="rounded-md border border-neutral-200 px-2 py-1 hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-800 dark:hover:border-neutral-600 dark:hover:text-neutral-100"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
