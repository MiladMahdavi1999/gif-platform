import { HealthIndicator } from './health-indicator';

export default function Home() {
  return (
    <main>
      <p className="eyebrow">Local environment</p>
      <h1>GIF Platform — local development</h1>
      <p>Environment status</p>
      <HealthIndicator />
      <p>
        <a href="/login">Sign in</a> · <a href="/review">Review access</a>
      </p>
    </main>
  );
}
