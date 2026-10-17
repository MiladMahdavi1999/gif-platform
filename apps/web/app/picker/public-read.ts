import { publicDetailSchema, publicGifsSchema } from '@gif/contracts';

export class PickerReadError extends Error {
  constructor(public readonly restricted: boolean) {
    super(restricted ? 'GIF unavailable' : 'Public read unavailable');
  }
}

async function read(path: string, signal: AbortSignal) {
  const response = await fetch(path, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  if (!response.ok)
    throw new PickerReadError([403, 404].includes(response.status));
  return response.json();
}

export async function searchGifs(
  q: string,
  signal: AbortSignal,
  cursor?: string,
) {
  const query = new URLSearchParams({ q });
  if (cursor) query.set('cursor', cursor);
  return publicGifsSchema.parse(
    await read(`/api/v1/public/gifs?${query}`, signal),
  );
}

/** Always query the authoritative B06 detail route, never trust the result grid. */
export async function eligibleGif(id: string, signal: AbortSignal) {
  const detail = publicDetailSchema.parse(
    await read(`/api/v1/public/gifs/${encodeURIComponent(id)}`, signal),
  );
  if (
    detail.id !== id ||
    detail.posterUrl !== `/media/${id}/poster.png` ||
    detail.displayUrl !== `/media/${id}/display.gif`
  )
    throw new PickerReadError(false);
  return detail;
}
