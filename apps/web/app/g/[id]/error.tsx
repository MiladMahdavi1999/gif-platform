'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
export default function ErrorPage({ reset }: { reset: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <main>
      <h1>GIF service unavailable</h1>
      <p role="alert">The GIF could not be loaded. Please retry.</p>
      <button
        disabled={pending}
        onClick={() =>
          startTransition(() => {
            // A server-component failure needs fresh API data as well as a boundary reset.
            router.refresh();
            reset();
          })
        }
      >
        {pending ? 'Retrying detail…' : 'Retry detail'}
      </button>
    </main>
  );
}
