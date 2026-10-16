'use client';
import { useState } from 'react';
export function ShareLink() {
  const [message, setMessage] = useState('');
  return (
    <>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            setMessage('Detail link copied.');
          } catch {
            setMessage('Unable to copy. Copy the address from your browser.');
          }
        }}
      >
        Copy detail link
      </button>
      <p aria-live="polite">{message}</p>
    </>
  );
}
