'use client';
import { useState, useSyncExternalStore } from 'react';
import type { PublicGif } from '@gif/contracts';
const subscribe = (callback: () => void) => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
};
export function PublicMedia({
  gif,
  playback = false,
  description,
}: {
  gif: PublicGif;
  playback?: boolean;
  description?: string | null;
}) {
  const reduced = useSyncExternalStore(
    subscribe,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => true,
  );
  return (
    <MediaPlayer
      key={`${gif.id}:${reduced}`}
      gif={gif}
      playback={playback}
      description={description}
      reduced={reduced}
    />
  );
}
function MediaPlayer({
  gif,
  playback,
  description,
  reduced,
}: {
  gif: PublicGif;
  playback: boolean;
  description?: string | null | undefined;
  reduced: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Motion always requires explicit consent. Changing the preference remounts playback state.
  return (
    <figure className="gif-media">
      {error ? (
        <div role="alert">
          <p>
            Media unavailable. It may have been removed. Retry to check again.
          </p>
          <button
            onClick={() => {
              setError(false);
              setAttempt((a) => a + 1);
              setPlaying(false);
            }}
          >
            Retry media
          </button>
        </div>
      ) : (
        <>
          {/* Native same-origin image avoids an optimizer cache bypassing the policy origin. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`${gif.id}:${playing}:${attempt}:${reduced}`}
            src={playback && playing ? gif.displayUrl : gif.posterUrl}
            alt={description || gif.title}
            loading={playback ? 'eager' : 'lazy'}
            onError={() => setError(true)}
          />
          {playback && (
            <button
              aria-pressed={playing}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? 'Pause GIF' : 'Play GIF'}
            </button>
          )}
        </>
      )}
      {playback && (
        <figcaption>
          {reduced
            ? 'Reduced motion is enabled. Animation plays only when you choose Play GIF.'
            : 'Static preview. Choose Play GIF to animate.'}
        </figcaption>
      )}
    </figure>
  );
}
