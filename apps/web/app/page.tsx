import Link from 'next/link';
import { HealthIndicator } from './health-indicator';

export default function Home() {
  return (
    <main>
      <p className="eyebrow">Local environment</p>
      <h1>GIF Platform — local development</h1>
      <p>Environment status</p>
      <HealthIndicator />
      <p>
        <Link href="/login">Sign in</Link> ·{' '}
        <Link href="/studio/upload">Upload GIF</Link> ·{' '}
        <Link href="/studio/assets">My receipts</Link> ·{' '}
        <Link href="/review">Review access</Link>
      </p>
    </main>
  );
}
