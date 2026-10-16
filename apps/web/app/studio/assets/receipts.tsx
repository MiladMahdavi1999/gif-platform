'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ownerAssetSchema,
  ownerAssetsSchema,
  type OwnerAsset,
} from '@gif/contracts';
import { useSession } from '../session';
export function AssetReceipts({ assetId }: { assetId?: string }) {
  const { session, error: sessionError } = useSession();
  const [items, setItems] = useState<OwnerAsset[] | null>(null);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  useEffect(() => {
    if (!session?.authenticated) return;
    const controller = new AbortController();
    const endpoint = assetId
      ? `/api/v1/me/assets/${encodeURIComponent(assetId)}`
      : `/api/v1/me/assets${cursor ? `?cursor=${cursor}` : ''}`;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(endpoint, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? 'Receipt not found.'
              : response.status === 401
                ? 'Session expired. Sign in again.'
                : 'Unable to load receipts. Refresh to retry.',
          );
        const data = await response.json();
        let values: OwnerAsset[];
        if (assetId) values = [ownerAssetSchema.parse(data)];
        else {
          const list = ownerAssetsSchema.parse(data);
          values = list.items.map(({ id, ...rest }) => ({
            assetId: id,
            ...rest,
          }));
          setNextCursor(list.nextCursor);
        }
        if (controller.signal.aborted) return;
        setError('');
        setItems(values);
        if (
          values.some((v) =>
            ['QUEUED', 'RUNNING', 'FAILED_RETRYABLE'].includes(
              v.states.processing,
            ),
          )
        )
          timer = setTimeout(poll, 1500);
      } catch {
        if (!controller.signal.aborted)
          setError('Unable to load receipts. Refresh to retry.');
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [session, assetId, cursor]);
  if (sessionError || error) return <p role="alert">{sessionError || error}</p>;
  if (session && !session.authenticated)
    return (
      <p role="status">
        <Link href="/login">Sign in</Link> to view your private receipts.
      </p>
    );
  if (!items) return <p role="status">Loading private receipts…</p>;
  return (
    <>
      <p role="status">
        Originals and processed derivatives remain private. Files are not
        published.
      </p>
      {items.length === 0 && <p>No private receipts yet.</p>}
      {items.map((item) => (
        <article key={item.assetId}>
          <h2>
            <Link href={`/studio/assets/${item.assetId}`}>{item.title}</Link>
          </h2>
          <p>Receipt ID: {item.assetId}</p>
          <p>Created: {new Date(item.createdAt).toLocaleString()}</p>
          <p>
            {item.tags.length ? `Tags: ${item.tags.join(', ')}` : 'No tags'}
          </p>
          <dl>
            {Object.entries(item.states).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {item.errorCode && <p role="alert">{item.errorCode}</p>}
          <p>
            {item.states.processing === 'SUCCEEDED'
              ? 'Processing succeeded. Private derivatives are ready for human moderation; not published.'
              : item.states.processing === 'FAILED_TERMINAL'
                ? 'Processing failed. This file cannot be processed. Start a new upload; nothing is published.'
                : item.states.processing === 'FAILED_RETRYABLE'
                  ? 'Processing interrupted. A retry is scheduled; not published.'
                  : item.states.processing === 'RUNNING'
                    ? 'Processing in progress; not published.'
                    : item.states.upload === 'RECEIVED'
                      ? 'Received privately. Processing queued; not processed or published.'
                      : item.states.upload === 'EXPIRED'
                        ? 'Upload expired before receipt. Start a new upload.'
                        : 'Upload not yet received. No processing or publication.'}
          </p>
        </article>
      ))}
      {!assetId && nextCursor && (
        <button
          onClick={() => {
            setItems(null);
            setCursor(nextCursor);
          }}
        >
          Older receipts
        </button>
      )}
      <p>
        <Link href="/studio/upload">Upload another GIF</Link> ·{' '}
        <Link href="/studio/assets">All receipts</Link>
      </p>
    </>
  );
}
