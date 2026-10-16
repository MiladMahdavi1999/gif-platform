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
    fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? 'Receipt not found.'
              : response.status === 401
                ? 'Session expired. Sign in again.'
                : 'Unable to load receipts. Refresh to retry.',
          );
        const data = await response.json();
        if (assetId) setItems([ownerAssetSchema.parse(data)]);
        else {
          const list = ownerAssetsSchema.parse(data);
          setItems(
            list.items.map(({ id, ...rest }) => ({ assetId: id, ...rest })),
          );
          setNextCursor(list.nextCursor);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : 'Unable to load receipts.',
          );
      });
    return () => controller.abort();
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
        Originals remain in private quarantine. Received files are queued;
        Processing is not running in this environment. Files are not published.
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
            {item.states.upload === 'RECEIVED'
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
