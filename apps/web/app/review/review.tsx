'use client';
import { useEffect, useState } from 'react';
import {
  assetIdSchema,
  reviewQueueSchema,
  reviewDetailSchema,
  reviewResultSchema,
  rejectionReasons,
  removalReasons,
  type ReviewDetail,
  type ReviewItem,
} from '@gif/contracts';
import { useSession } from '../studio/session';

function message(status: number) {
  return status === 409
    ? 'Conflict: this asset changed or approval prerequisites are missing. Reload the asset before deciding again.'
    : status === 401
      ? 'Session expired. Sign in again.'
      : status === 403
        ? 'Reviewer access or session verification denied.'
        : status === 404
          ? 'Asset not found.'
          : 'Review service unavailable. Please retry.';
}
export function Review() {
  const { session, error: sessionError } = useSession();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [next, setNext] = useState<string | undefined>();
  const [queueError, setQueueError] = useState('');
  const [id, setId] = useState('');
  const [inputId, setInputId] = useState('');
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [play, setPlay] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const allowed =
    session?.authenticated && session.user.roles.includes('REVIEWER');
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    fetch(`/api/v1/review/queue${cursor ? `?cursor=${cursor}` : ''}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(message(r.status));
        const value = reviewQueueSchema.parse(await r.json());
        if (!controller.signal.aborted) {
          setItems(value.items);
          setNext(value.nextCursor);
          setQueueError('');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setQueueError(e.message);
      });
    return () => controller.abort();
  }, [allowed, cursor, refresh]);
  useEffect(() => {
    if (!allowed || !id) return;
    const controller = new AbortController();
    fetch(`/api/v1/review/assets/${id}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(message(r.status));
        const value = reviewDetailSchema.parse(await r.json());
        if (!controller.signal.aborted) setDetail(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [allowed, id, refresh]);
  function reload() {
    setDetail(null);
    setError('');
    setConflict(false);
    setPlay(false);
    setPreviewError('');
    setRefresh((v) => v + 1);
  }
  function open(value: string) {
    setId(value);
    setDetail(null);
    setError('');
    setNotice('');
    setConflict(false);
    setReason('');
    setNote('');
    setPlay(false);
    setPreviewError('');
    setRefresh((v) => v + 1);
  }
  async function decide(action: 'APPROVE' | 'REJECT' | 'REMOVE') {
    if (!detail || !session?.authenticated || busy || conflict) return;
    if (action !== 'APPROVE' && !reason) {
      setError('Choose a reason before rejecting or removing.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch(
        `/api/v1/review/assets/${id}/${action === 'REMOVE' ? 'remove' : 'decision'}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': session.csrfToken,
          },
          body: JSON.stringify({
            ...(action === 'REMOVE' ? {} : { decision: action }),
            reasonCode: action === 'APPROVE' ? 'POLICY_PASSED' : reason,
            ...(note.trim() ? { reasonNote: note.trim() } : {}),
            expectedVersion: detail.rowVersion,
          }),
        },
      );
      if (!r.ok) {
        if (r.status === 409) setConflict(true);
        throw new Error(message(r.status));
      }
      const result = reviewResultSchema.parse(await r.json());
      setNotice(`Decision saved: ${result.states.moderation}.`);
      setReason('');
      setNote('');
      reload();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Unable to save decision. Retry the same decision or reload.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (sessionError) return <p role="alert">{sessionError}</p>;
  if (!session) return <p role="status">Checking reviewer session…</p>;
  if (!allowed)
    return (
      <p role="alert">
        Reviewer access required. Sign in with a reviewer account.
      </p>
    );
  return (
    <>
      <section aria-label="Pending queue">
        <h2>Awaiting moderation</h2>
        <button
          disabled={busy}
          onClick={() => {
            setItems(null);
            setQueueError('');
            setCursor(undefined);
            setRefresh((v) => v + 1);
          }}
        >
          Refresh queue
        </button>
        {queueError ? (
          <p role="alert">{queueError}</p>
        ) : items === null ? (
          <p role="status">Loading queue…</p>
        ) : items.length === 0 ? (
          <p>No processed GIFs awaiting moderation.</p>
        ) : (
          <ul>
            {items.map((i) => (
              <li key={i.assetId}>
                <button disabled={busy} onClick={() => open(i.assetId)}>
                  {i.title}
                </button>{' '}
                — {i.processing} / {i.moderation}
              </li>
            ))}
          </ul>
        )}
        {next && (
          <button
            disabled={busy}
            onClick={() => {
              setItems(null);
              setCursor(next);
            }}
          >
            Next page
          </button>
        )}
      </section>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (assetIdSchema.safeParse(inputId).success) open(inputId);
          else setError('Enter a valid asset ID.');
        }}
      >
        <label>
          Asset ID
          <input
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            disabled={busy}
          />
        </label>
        <button disabled={busy}>Open asset</button>
      </form>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {id && (
        <section aria-label="Review detail" aria-busy={busy}>
          <button disabled={busy} onClick={reload}>
            Reload asset
          </button>
          {!detail ? (
            <p role="status">
              {error ? 'Asset detail unavailable.' : 'Loading asset…'}
            </p>
          ) : (
            <>
              <h2>{detail.title}</h2>
              <p>
                Asset ID: <code>{detail.assetId}</code>
              </p>
              <p>Owner: {detail.ownerId}</p>
              <p>Tags: {detail.tags.join(', ') || 'None'}</p>
              <p>
                Rights attested:{' '}
                {detail.rightsAttested ? 'Yes (uploader assertion)' : 'No'}
              </p>
              <p>Version: {detail.rowVersion}</p>
              <dl>
                {Object.entries(detail.states).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {detail.previews.length > 0 ? (
                <>
                  {/* Private same-origin API images require cookies; Next image optimization would bypass that boundary. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={`Private ${play ? 'animated GIF' : 'poster'} preview of ${detail.title}`}
                    src={
                      detail.previews.find(
                        (v) =>
                          v.variant === (play ? 'DISPLAY_GIF' : 'POSTER_PNG'),
                      )?.path
                    }
                    onError={() =>
                      setPreviewError(
                        'Private preview unavailable. Reload the asset or try again later.',
                      )
                    }
                    style={{
                      maxWidth: '100%',
                      minWidth: 96,
                      minHeight: 96,
                      imageRendering: 'pixelated',
                    }}
                  />
                  <button
                    disabled={busy}
                    onClick={() => {
                      setPreviewError('');
                      setPlay((v) => !v);
                    }}
                  >
                    {play ? 'Show static poster' : 'Play private GIF'}
                  </button>
                  {previewError && <p role="alert">{previewError}</p>}
                </>
              ) : (
                <p>No verified private previews available.</p>
              )}
              {(detail.moderation === 'PENDING' ||
                detail.moderation === 'APPROVED') && (
                <fieldset
                  disabled={
                    busy || conflict || detail.ownerId === session.user.id
                  }
                >
                  <legend>
                    {detail.moderation === 'APPROVED'
                      ? 'Takedown'
                      : 'Review decision'}
                  </legend>
                  <label htmlFor="review-reason">Reason</label>
                  <select
                    id="review-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  >
                    <option value="">Choose a reason</option>
                    {(detail.moderation === 'APPROVED'
                      ? removalReasons
                      : rejectionReasons
                    ).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <label>
                    Optional notes
                    <textarea
                      maxLength={2000}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                  {detail.moderation === 'PENDING' ? (
                    <>
                      <button onClick={() => void decide('APPROVE')}>
                        Approve
                      </button>
                      <button onClick={() => void decide('REJECT')}>
                        Reject
                      </button>
                    </>
                  ) : (
                    <button onClick={() => void decide('REMOVE')}>
                      Remove / takedown
                    </button>
                  )}
                </fieldset>
              )}
              {busy && <p role="status">Saving decision…</p>}
              {detail.ownerId === session.user.id && (
                <p role="alert">Owners cannot review their own assets.</p>
              )}
              <h3>Decision history</h3>
              {detail.decisions.length === 0 ? (
                <p>No decisions yet.</p>
              ) : (
                <ol>
                  {detail.decisions.map((d) => (
                    <li key={d.id}>
                      {d.action} — {d.reasonCode}
                      {d.reasonNote ? ` — ${d.reasonNote}` : ''} · reviewer{' '}
                      {d.reviewerId} · {d.decidedAt} · prior {d.priorState}
                    </li>
                  ))}
                </ol>
              )}
              <h3>Audit history</h3>
              <ol>
                {detail.audit.map((e) => (
                  <li key={e.id}>
                    {e.eventType} · {e.createdAt}
                    {e.decisionId ? ` · decision ${e.decisionId}` : ''}
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}
    </>
  );
}
