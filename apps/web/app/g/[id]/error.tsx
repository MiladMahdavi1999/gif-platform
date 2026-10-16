'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main>
      <h1>GIF service unavailable</h1>
      <p role="alert">The GIF could not be loaded. Please retry.</p>
      <button onClick={reset}>Retry detail</button>
    </main>
  );
}
