'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { PickerCallbacks, PickerError, PublicGif } from '@gif/contracts';
import { PublicMedia } from '../public-media';
import { createPickerSession } from './picker-session';
import { PickerReadError, searchGifs } from './public-read';

/** Mount to open; unmount after onSelect/onCancel. No SDK or cross-origin bridge. */
export function GifPicker(callbacks: PickerCallbacks) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const helpId = useId();
  const [query, setQuery] = useState({ q: '', attempt: 0 });
  const [failure, setFailure] = useState<PickerError>();
  const [selecting, setSelecting] = useState(false);
  const [retryId, setRetryId] = useState<string>();
  const session = useRef<ReturnType<typeof createPickerSession> | null>(null);
  const [handlers] = useState(() => ({
    ...callbacks,
    onError(error: PickerError) {
      setFailure(error);
      setSelecting(false);
      callbacks.onError(error);
    },
  }));
  useEffect(() => {
    const active = createPickerSession(handlers);
    session.current = active;
    const opener = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    input.current?.focus();
    return () => {
      active.dispose();
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [handlers]);
  const select = (id: string) => {
    if (selecting) return;
    setFailure(undefined);
    setRetryId(id);
    setSelecting(true);
    void session.current?.select(id);
  };
  const trapFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
      ),
    ).filter((element) => element.getClientRects().length);
    const first = controls[0],
      last = controls.at(-1);
    if (
      event.shiftKey
        ? document.activeElement === first
        : document.activeElement === last
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  };
  return (
    <dialog
      ref={dialog}
      className="gif-picker"
      aria-labelledby={titleId}
      aria-describedby={helpId}
      onKeyDown={trapFocus}
      onCancel={(event) => {
        event.preventDefault();
        session.current?.cancel();
      }}
      onClose={() => {
        if (!dialog.current?.open) session.current?.cancel();
      }}
    >
      <h2 id={titleId}>Choose a GIF</h2>
      <p id={helpId}>
        Select a reference for the host. Selection performs no send or post. Use
        Tab to move between controls, arrow keys between Select buttons, Enter
        or Space to select, and Escape to cancel.
      </p>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (selecting) return;
          setFailure(undefined);
          setQuery((previous) => ({
            q: input.current!.value.trim(),
            attempt: previous.attempt + 1,
          }));
        }}
      >
        <label htmlFor={`${titleId}-search`}>Search GIFs</label>
        <input
          ref={input}
          id={`${titleId}-search`}
          type="search"
          maxLength={100}
        />
        <button type="submit" disabled={selecting}>
          Search
        </button>
      </form>
      <p role="status">{selecting ? 'Checking GIF eligibility…' : ''}</p>
      {failure && (
        <div role="alert">
          <p>
            {failure.code === 'GIF_RESTRICTED'
              ? 'This GIF is unavailable or restricted. Search again or choose another GIF.'
              : 'Eligibility could not be checked. Nothing selected. Please retry.'}
          </p>
          {failure.code === 'SELECTION_UNAVAILABLE' && retryId && (
            <button onClick={() => select(retryId)}>Retry selection</button>
          )}
        </div>
      )}
      <PickerResults
        key={JSON.stringify(query)}
        q={query.q}
        selecting={selecting}
        select={select}
        onError={callbacks.onError}
      />
      <button
        className="picker-cancel"
        onClick={() => session.current?.cancel()}
      >
        Cancel
      </button>
    </dialog>
  );
}

function PickerResults({
  q,
  selecting,
  select,
  onError,
}: {
  q: string;
  selecting: boolean;
  select(id: string): void;
  onError: PickerCallbacks['onError'];
}) {
  const [items, setItems] = useState<PublicGif[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const failedCursor = useRef<string | undefined>(undefined);
  // Callbacks are captured for the mounted search, not dependencies that restart it.
  const notify = useRef(onError);
  const load = async (active: AbortController, next?: string) => {
    failedCursor.current = next;
    try {
      const page = await searchGifs(q, active.signal, next);
      if (active.signal.aborted) return;
      setItems((previous) =>
        next
          ? [
              ...previous,
              ...page.items.filter(
                (item) => !previous.some((p) => p.id === item.id),
              ),
            ]
          : page.items,
      );
      setCursor(page.nextCursor);
    } catch (failure) {
      if (active.signal.aborted) return;
      setError(
        failure instanceof PickerReadError && failure.restricted
          ? 'GIF search is restricted or unavailable.'
          : 'GIFs could not be loaded. Please retry.',
      );
      notify.current({ code: 'SEARCH_UNAVAILABLE' });
    } finally {
      if (!active.signal.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    void load(active, failedCursor.current);
    return () => {
      controller.current?.abort();
    };
    // q is fixed for this keyed search; attempt explicitly retries the failed page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const navigate = (event: KeyboardEvent<HTMLUListElement>) => {
    if (
      !(event.target instanceof HTMLButtonElement) ||
      !event.target.hasAttribute('data-picker-select')
    )
      return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[data-picker-select]',
      ),
    );
    const index = buttons.indexOf(event.target);
    const columns = getComputedStyle(
      event.currentTarget,
    ).gridTemplateColumns.split(' ').length;
    const target = (
      {
        ArrowRight: index + 1,
        ArrowLeft: index - 1,
        ArrowDown: index + columns,
        ArrowUp: index - columns,
        Home: 0,
        End: buttons.length - 1,
      } as Record<string, number>
    )[event.key];
    if (target === undefined) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(target, buttons.length - 1))]?.focus();
  };
  return (
    <section aria-label="Picker search results">
      <p role="status">
        {loading ? 'Loading GIFs…' : error ? '' : `${items.length} GIFs shown`}
      </p>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            disabled={selecting}
            onClick={() => {
              setError('');
              setLoading(true);
              setAttempt((a) => a + 1);
            }}
          >
            Retry search
          </button>
        </div>
      )}
      {!loading && !error && !items.length && (
        <p>No GIFs found. Try another title or tag.</p>
      )}
      <ul
        className="gif-grid"
        aria-label="GIF choices"
        aria-busy={loading}
        onKeyDown={navigate}
      >
        {items.map((gif) => (
          <li key={gif.id}>
            <h3>{gif.title}</h3>
            <PublicMedia gif={gif} playback />
            <button
              data-picker-select
              aria-disabled={selecting}
              onClick={() => select(gif.id)}
            >
              Select {gif.title}
            </button>
          </li>
        ))}
      </ul>
      {cursor && !error && (
        <button
          disabled={loading || selecting}
          onClick={() => {
            controller.current?.abort();
            const active = new AbortController();
            controller.current = active;
            setLoading(true);
            void load(active, cursor);
          }}
        >
          Load more GIFs
        </button>
      )}
    </section>
  );
}
