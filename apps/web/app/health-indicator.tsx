'use client';

import { useEffect, useState } from 'react';
import { readinessSchema } from '@gif/contracts';

export function HealthIndicator() {
  const [health, setHealth] = useState('Checking dependencies…');
  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    async function check() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 4000);
      try {
        const response = await fetch('/api/v1/health/ready', {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = readinessSchema.parse(await response.json());
        const ready =
          response.status === 200 &&
          body.status === 'ready' &&
          body.checks.database === 'up' &&
          body.checks.storage === 'up';
        if (active)
          setHealth(
            ready
              ? 'Dependencies ready — PostgreSQL and object store reachable'
              : 'Dependencies unavailable',
          );
      } catch {
        if (active) setHealth('API unavailable or health response invalid');
      } finally {
        clearTimeout(timeout);
      }
    }
    void check();
    const interval = setInterval(() => void check(), 5000);
    return () => {
      active = false;
      clearInterval(interval);
      controller?.abort();
    };
  }, []);
  return (
    <p role="status" aria-live="polite">
      {health}
    </p>
  );
}
