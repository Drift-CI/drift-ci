import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'drift-ci',
  description: 'Behaviour regression testing for LLM applications',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
