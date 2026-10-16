'use client';
import { useRef, useState, type FormEvent } from 'react';
import {
  uploadIntentSchema,
  uploadRequestSchema,
  uploadCompletionSchema,
  type UploadIntent,
} from '@gif/contracts';
import { useSession, apiError } from '../session';

export function UploadForm() {
  const { session, error: sessionError } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Choose an animated GIF to begin.');
  const [progress, setProgress] = useState(0);
  const [intent, setIntent] = useState<UploadIntent | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const attempt = useRef<{
    key: string;
    input: string;
    intent?: UploadIntent;
    posted: boolean;
  } | null>(null);
  if (sessionError) return <p role="alert">{sessionError}</p>;
  if (!session) return <p role="status">Checking session…</p>;
  if (!session.authenticated)
    return (
      <p role="status">
        <a href="/login">Sign in</a> to upload and view private receipts.
      </p>
    );
  if (!session.user.roles.includes('UPLOADER'))
    return <p role="alert">Uploader access is required.</p>;
  const csrf = session.csrfToken;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (
      !file ||
      !file.name.toLowerCase().endsWith('.gif') ||
      file.type !== 'image/gif' ||
      file.size < 1 ||
      file.size > 20971520
    ) {
      setError('Choose a nonempty GIF file up to 20 MiB.');
      return;
    }
    const form = new FormData(event.currentTarget);
    const input = uploadRequestSchema.safeParse({
      kind: 'GIF',
      title: form.get('title'),
      tags: String(form.get('tags') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      rightsAttested: form.get('rights') === 'on',
      rightsAttestationVersion: 'v1',
      claimedSizeBytes: file.size,
    });
    if (!input.success) {
      setError(
        'Enter a title, up to 10 distinct tags of 64 characters, and confirm your rights.',
      );
      return;
    }
    const serialized = JSON.stringify(input.data);
    if (!attempt.current || attempt.current.input !== serialized)
      attempt.current = {
        key: crypto.randomUUID(),
        input: serialized,
        posted: false,
      };
    const current = attempt.current;
    setBusy(true);
    setAttempted(true);
    try {
      setStatus('Requesting private upload permission…');
      if (!current.intent) {
        const response = await fetch('/api/v1/uploads', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
            'Idempotency-Key': current.key,
          },
          body: serialized,
        });
        if (!response.ok) throw new Error(await apiError(response));
        current.intent = uploadIntentSchema.parse(await response.json());
        setIntent(current.intent);
      }
      if (!current.posted) {
        const body = new FormData();
        for (const [key, value] of Object.entries(current.intent.form.fields))
          body.append(key, value);
        body.append('file', file); // S3 requires the file field last.
        setProgress(0);
        setStatus('Uploading directly to private storage…');
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', current.intent!.form.url);
          xhr.timeout = 120000;
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable)
              setProgress(Math.floor((e.loaded / e.total) * 100));
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(
                  new Error(
                    'Storage rejected the upload. Permission may have expired. Choose a new upload or retry.',
                  ),
                );
          xhr.onerror = () =>
            reject(
              new Error('Unable to reach private storage. Retry this upload.'),
            );
          xhr.ontimeout = () =>
            reject(new Error('Storage upload timed out. Retry this upload.'));
          xhr.send(body); // Deliberately no cookies or permanent S3 credentials.
        });
        current.posted = true;
        setProgress(100);
      }
      setStatus(
        'Bytes transferred. Verifying storage and saving your receipt…',
      );
      const response = await fetch(
        `/api/v1/uploads/${current.intent.uploadId}/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: '{}',
        },
      );
      if (!response.ok) throw new Error(await apiError(response));
      const result = uploadCompletionSchema.parse(await response.json());
      setReceipt(result.assetId);
      setStatus(
        'Received privately. Processing queued; not processed or published.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Upload failed. Please retry.',
      );
      setStatus(
        'Upload not confirmed. A durable receipt has not been confirmed.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <p role="status" aria-live="polite">
        {status}
      </p>
      {!receipt && (
        <form onSubmit={submit}>
          <label htmlFor="gif">Animated GIF (up to 20 MiB)</label>
          <input
            id="gif"
            type="file"
            accept="image/gif,.gif"
            disabled={busy}
            required
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              attempt.current = null;
              setAttempted(false);
              setIntent(null);
              setProgress(0);
              setError('');
            }}
          />
          <label htmlFor="title">Title</label>
          <input
            id="title"
            name="title"
            required
            maxLength={160}
            disabled={busy}
          />
          <label htmlFor="tags">Tags (comma separated, optional)</label>
          <input id="tags" name="tags" disabled={busy} />
          <label>
            <input name="rights" type="checkbox" required disabled={busy} /> I
            own this file or have permission to upload it. This attestation does
            not grant public distribution approval.
          </label>
          <button type="submit" disabled={busy}>
            {busy
              ? 'Uploading…'
              : attempted
                ? 'Retry upload'
                : 'Upload privately'}
          </button>
          {intent && (
            <>
              <a href={`/studio/assets/${intent.assetId}`}>
                View current private status
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  attempt.current = null;
                  setAttempted(false);
                  setIntent(null);
                  setProgress(0);
                  setError('');
                  setStatus('Ready for a new upload attempt.');
                }}
              >
                Start a new upload
              </button>
            </>
          )}
        </form>
      )}
      <label htmlFor="upload-progress">Storage transfer: {progress}%</label>
      <progress id="upload-progress" max={100} value={progress} />
      {receipt && (
        <p>
          <a href={`/studio/assets/${receipt}`}>View durable private receipt</a>
        </p>
      )}
    </>
  );
}
