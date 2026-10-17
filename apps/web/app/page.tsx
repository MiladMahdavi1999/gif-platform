import { Suspense } from 'react';
import { Gallery } from './gallery';
import type { Metadata } from 'next';
import Link from 'next/link';
import { HealthIndicator } from './health-indicator';

export const metadata: Metadata = {
  description: 'Discover approved original GIFs by title and tag.',
  robots: { index: true, follow: true },
};

export default function Home() {
  return (
    <main className="public-page">
      <p className="eyebrow">Local environment</p>
      <h1>GIF Platform — local development</h1>
      <p>
        <Link href="/login">Sign in</Link> ·{' '}
        <Link href="/studio/upload">Upload GIF</Link> ·{' '}
        <Link href="/studio/assets">My receipts</Link> ·{' '}
        <Link href="/review">Review access</Link>
      </p>
      <Suspense fallback={<p aria-live="polite">Loading GIFs…</p>}>
        <Gallery />
      </Suspense>
      <footer>
        <p>Environment status</p>
        <HealthIndicator />
      </footer>
    </main>
  );
}
