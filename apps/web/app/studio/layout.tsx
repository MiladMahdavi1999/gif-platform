import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Private studio — GIF Platform',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';
export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main>
      <p className="eyebrow">Private studio</p>
      <nav aria-label="Studio">
        <Link href="/studio/upload">Upload GIF</Link> ·{' '}
        <Link href="/studio/assets">My receipts</Link> ·{' '}
        <Link href="/login">Account</Link> · <Link href="/">Home</Link>
      </nav>
      {children}
    </main>
  );
}
