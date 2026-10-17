'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { PickerResult } from '@gif/contracts';
import { GifPicker } from '../../picker/gif-picker';

export function HostPickerDemo() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PickerResult>();
  const [count, setCount] = useState(0);
  const receive = (value: PickerResult) => {
    setResult(value);
    setCount((previous) => previous + 1);
    setOpen(false);
  };
  return (
    <main className="public-page">
      <p className="eyebrow">Embedded browser Picker demo</p>
      <h1>Choose a GIF for a host</h1>
      <p>
        The Picker returns a selected GIF reference or a cancellation. This demo
        performs no host action: it does not send a message or publish a post.
      </p>
      <button
        onClick={() => {
          setResult(undefined);
          setOpen(true);
        }}
      >
        Open GIF Picker
      </button>
      <p role="status">
        {result?.status === 'selected'
          ? 'Selected; no host action performed.'
          : result?.status === 'cancelled'
            ? 'Cancelled; no host action performed.'
            : 'No selection received.'}
      </p>
      <p>
        Terminal callbacks received:{' '}
        <output aria-label="Terminal callbacks received">{count}</output>
      </p>
      {result?.status === 'selected' && (
        <section aria-label="Selected GIF reference" className="picker-receipt">
          <h2>{result.reference.title}</h2>
          <p>Result: selected. Kind: {result.reference.kind}.</p>
          <p>
            Reference ID: <code>{result.reference.id}</code>
          </p>
          <p>
            Poster reference: <code>{result.reference.posterUrl}</code>
          </p>
          <p>
            Animation reference: <code>{result.reference.displayUrl}</code>
          </p>
          <p>
            This reference records selection only. Eligibility may change before
            any future host action.
          </p>
        </section>
      )}
      <p>
        <Link href="/">Back to public gallery</Link>
      </p>
      {open && (
        <GifPicker
          onSelect={(reference) => receive({ status: 'selected', reference })}
          onCancel={() => receive({ status: 'cancelled' })}
          onError={() => {
            /* Recoverable errors remain visible inside the Picker. */
          }}
        />
      )}
    </main>
  );
}
