import type { Metadata } from 'next';
import Link from 'next/link';
import { Review } from './review';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Private review — GIF Platform',
  robots: { index: false, follow: false },
};
export default function ReviewPage() {
  return (
    <main>
      <h1>Reviewer queue</h1>
      <p>Reviewer access verified.</p>
      <nav>
        <Link href="/login">Account</Link> · <Link href="/">Home</Link>
      </nav>
      <Review />
    </main>
  );
}
