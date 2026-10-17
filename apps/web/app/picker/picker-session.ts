import type { PickerCallbacks } from '@gif/contracts';
import { eligibleGif, PickerReadError } from './public-read.js';

/** Synchronous guards also cover events arriving before React rerenders. */
export function createPickerSession(
  callbacks: PickerCallbacks,
  lookup: typeof eligibleGif = eligibleGif,
) {
  let settled = false;
  let pending: AbortController | undefined;
  return {
    async select(id: string) {
      if (settled || pending) return;
      const active = new AbortController();
      pending = active;
      let gif;
      try {
        gif = await lookup(id, active.signal);
      } catch (error) {
        if (settled || active.signal.aborted) return;
        pending = undefined;
        callbacks.onError({
          code:
            error instanceof PickerReadError && error.restricted
              ? 'GIF_RESTRICTED'
              : 'SELECTION_UNAVAILABLE',
        });
        return;
      }
      if (settled || active.signal.aborted) return;
      settled = true;
      pending = undefined;
      callbacks.onSelect({
        id: gif.id,
        kind: 'GIF',
        title: gif.title,
        posterUrl: gif.posterUrl,
        displayUrl: gif.displayUrl,
      });
    },
    cancel() {
      if (settled) return;
      settled = true;
      pending?.abort();
      callbacks.onCancel();
    },
    dispose() {
      settled = true;
      pending?.abort();
    },
  };
}
