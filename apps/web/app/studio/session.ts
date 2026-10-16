'use client';
import { useEffect, useState } from 'react';
import { sessionResponseSchema, type SessionResponse } from '@gif/contracts';
export function useSession() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/auth/session', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        setSession(sessionResponseSchema.parse(await r.json()));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Unable to check session. Refresh to retry.');
      });
    return () => controller.abort();
  }, []);
  return { session, error };
}
export async function apiError(response: Response): Promise<string> {
  try {
    const code = (await response.json()).error?.code;
    const messages: Record<string, string> = {
      UNAUTHENTICATED: 'Your session expired. Sign in and retry.',
      FORBIDDEN: 'Uploader access is required.',
      CSRF_REJECTED: 'Session verification failed. Refresh and retry.',
      UPLOAD_INTENT_EXPIRED: 'Upload expired. Choose a new upload to retry.',
      UPLOAD_OBJECT_MISSING:
        'File has not reached storage. Retry the file upload.',
      UPLOAD_SIZE_MISMATCH:
        'Stored size does not match the file. Choose a new upload.',
      UPLOAD_MIME_MISMATCH:
        'Stored file type is incorrect. Choose a new upload.',
      UPLOAD_TOO_LARGE: 'File exceeds the server upload limit.',
      UPLOAD_RATE_LIMITED: 'Too many uploads. Try again later.',
      IDEMPOTENCY_CONFLICT: 'Upload metadata changed. Choose a new upload.',
    };
    return messages[code] ?? 'Upload service unavailable. Please retry.';
  } catch {
    return 'Upload service unavailable. Please retry.';
  }
}
