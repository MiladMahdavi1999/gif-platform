import { cache } from 'react';
import { publicDetailSchema } from '@gif/contracts';
export const getPublicGif = cache(async (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  const response = await fetch(
    `${process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'}/api/v1/public/gifs/${encodeURIComponent(id)}`,
    { cache: 'no-store', signal: AbortSignal.timeout(5000) },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Public GIF service unavailable');
  return publicDetailSchema.parse(await response.json());
});
