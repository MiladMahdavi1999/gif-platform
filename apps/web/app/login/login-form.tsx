'use client';
import Link from 'next/link';

import { useEffect, useState, type FormEvent } from 'react';
import {
  loginRequestSchema,
  sessionResponseSchema,
  loginResponseSchema,
  type SessionResponse,
} from '@gif/contracts';

export function LoginForm() {
  const [session, setSession] = useState<SessionResponse>({
    authenticated: false,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/auth/session', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setSession(sessionResponseSchema.parse(await response.json()));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Unable to check your session. Please try again.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = event.currentTarget;
    const values = new FormData(form);
    const parsed = loginRequestSchema.safeParse({
      email: values.get('email'),
      password: values.get('password'),
    });
    if (!parsed.success) {
      setError('Enter a valid email and password.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      form.reset();
      if (!response.ok) {
        setError(
          response.status === 401
            ? 'Invalid email or password.'
            : response.status === 429
              ? 'Too many login attempts. Please try again later.'
              : 'Unable to sign in. Please try again.',
        );
        return;
      }
      const result = loginResponseSchema.parse(await response.json());
      setSession({ authenticated: true, ...result });
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (!session.authenticated) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken },
      });
      if (response.status === 204 || response.status === 401)
        setSession({ authenticated: false });
      else setError('Unable to sign out. Refresh and try again.');
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <p role="status">Checking session…</p>;
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {session.authenticated ? (
        <>
          <p role="status">Signed in as {session.user.email}</p>
          <p>Roles: {session.user.roles.join(', ')}</p>
          <p>
            <Link href="/studio/upload">Upload GIF</Link> ·{' '}
            <Link href="/studio/assets">My receipts</Link> ·{' '}
            <Link href="/review">Review access check</Link>
          </p>
          <button type="button" disabled={busy} onClick={logout}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </>
      ) : (
        <form onSubmit={login}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            disabled={busy}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
            disabled={busy}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      )}
    </>
  );
}
