'use client';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { publicGifsSchema, type PublicGif } from '@gif/contracts';
import { PublicMedia } from './public-media';

async function fetchPage(
  q: string,
  tag: string,
  next: string | undefined,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({ q });
  if (tag) query.set('tag', tag);
  if (next) query.set('cursor', next);
  const response = await fetch(`/api/v1/public/gifs?${query}`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok)
    throw new Error(
      response.status === 400
        ? 'Check your search: use up to 100 characters and a tag up to 64 characters.'
        : 'GIFs could not be loaded. Please retry.',
    );
  return publicGifsSchema.parse(await response.json());
}

export function Gallery() {
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const tag = params.get('tag') ?? '';
  return <SearchGallery key={JSON.stringify([q, tag])} q={q} tag={tag} />;
}
function SearchGallery({ q, tag }: { q: string; tag: string }) {
  const router = useRouter();
  const [items, setItems] = useState<PublicGif[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const load = async (next?: string) => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    try {
      const data = await fetchPage(q, tag, next, active.signal);
      if (active.signal.aborted) return;
      setItems((previous) =>
        next
          ? [
              ...previous,
              ...data.items.filter(
                (item) => !previous.some((p) => p.id === item.id),
              ),
            ]
          : data.items,
      );
      setCursor(data.nextCursor);
    } catch (e) {
      if (!active.signal.aborted)
        setError(
          e instanceof Error && e.message.startsWith('Check your search')
            ? e.message
            : 'GIFs could not be loaded. Please retry.',
        );
    } finally {
      if (!active.signal.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    fetchPage(q, tag, undefined, active.signal)
      .then((data) => {
        if (!active.signal.aborted) {
          setItems(data.items);
          setCursor(data.nextCursor);
          setError('');
        }
      })
      .catch((e) => {
        if (!active.signal.aborted)
          setError(
            e instanceof Error && e.message.startsWith('Check your search')
              ? e.message
              : 'GIFs could not be loaded. Please retry.',
          );
      })
      .finally(() => {
        if (!active.signal.aborted) setLoading(false);
      });
    return () => active.abort();
  }, [q, tag, attempt]);
  return (
    <section aria-labelledby="gallery-title">
      <h2 id="gallery-title">Discover GIFs</h2>
      <form
        className="search-form"
        key={JSON.stringify([q, tag])}
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          const query = new URLSearchParams();
          const value = String(values.get('q') ?? '').trim();
          const filter = String(values.get('tag') ?? '').trim();
          if (value) query.set('q', value);
          if (filter) query.set('tag', filter);
          router.push(`/?${query}`);
          if (value === q && filter === tag) {
            setLoading(true);
            setError('');
            setAttempt((a) => a + 1);
          }
        }}
      >
        <label htmlFor="gif-search">Search GIFs</label>
        <input
          id="gif-search"
          name="q"
          type="search"
          maxLength={100}
          defaultValue={q}
          placeholder="Search titles and tags"
        />
        <label htmlFor="gif-tag">Filter by tag</label>
        <input
          id="gif-tag"
          name="tag"
          maxLength={64}
          defaultValue={tag}
          placeholder="Any tag"
        />
        <button type="submit">Search</button>
      </form>
      <p aria-live="polite">
        {loading
          ? 'Loading GIFs…'
          : error
            ? ''
            : `${items.length} GIF${items.length === 1 ? '' : 's'} shown`}
      </p>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              setError('');
              if (items.length && cursor) void load(cursor);
              else setAttempt((a) => a + 1);
            }}
          >
            Retry search
          </button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <p>No GIFs found. Try another title or tag.</p>
      )}
      <ul className="gif-grid" aria-label="GIF results" aria-busy={loading}>
        {items.map((item) => (
          <li key={item.id}>
            <PublicMedia gif={item} />
            <h3>
              <Link href={`/g/${item.id}`}>{item.title}</Link>
            </h3>
            <p className="attribution">{item.creator.displayName}</p>
            <ul className="tags" aria-label={`Tags for ${item.title}`}>
              {item.tags.map((t) => (
                <li key={t}>
                  <Link href={`/?tag=${encodeURIComponent(t)}`}>#{t}</Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {cursor && !error && (
        <button
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setError('');
            void load(cursor);
          }}
        >
          Load more GIFs
        </button>
      )}
    </section>
  );
}
