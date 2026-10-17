import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export class PublicFault extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const publicNotFound = () =>
  new PublicFault(404, 'NOT_FOUND', 'GIF not found');
export const mediaUnavailable = () =>
  new PublicFault(503, 'MEDIA_UNAVAILABLE', 'Media unavailable. Please retry.');
export interface PublicPosition {
  rank: number;
  createdAt: string;
  id: string;
}
export function createPublicCursor(secret: string) {
  if (Buffer.byteLength(secret) < 32)
    throw new Error('Cursor signing key must contain at least 32 bytes');
  const digest = (q: string, tag?: string) =>
    createHash('sha256')
      .update(JSON.stringify([q.toLowerCase(), tag ?? null]))
      .digest('hex');
  const sign = (value: string) =>
    createHmac('sha256', secret).update(value).digest();
  return {
    encode(position: PublicPosition, q: string, tag?: string) {
      const value = Buffer.from(
        JSON.stringify({ v: 1, query: digest(q, tag), ...position }),
      ).toString('base64url');
      return `${value}.${sign(value).toString('base64url')}`;
    },
    decode(cursor: string, q: string, tag?: string): PublicPosition {
      try {
        if (cursor.length > 2048) throw new Error();
        const [value, signature, extra] = cursor.split('.');
        if (
          !value ||
          !signature ||
          extra !== undefined ||
          !/^[A-Za-z0-9_-]+$/.test(value) ||
          !/^[A-Za-z0-9_-]{43}$/.test(signature)
        )
          throw new Error();
        const actual = Buffer.from(signature, 'base64url');
        if (
          actual.toString('base64url') !== signature ||
          !timingSafeEqual(actual, sign(value))
        )
          throw new Error();
        const p = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        if (
          p.v !== 1 ||
          p.query !== digest(q, tag) ||
          typeof p.rank !== 'number' ||
          !Number.isFinite(p.rank) ||
          p.rank < 0 ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(p.createdAt) ||
          !Number.isFinite(Date.parse(p.createdAt)) ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
            p.id,
          )
        )
          throw new Error();
        return { rank: p.rank, createdAt: p.createdAt, id: p.id };
      } catch {
        throw new PublicFault(
          400,
          'INVALID_CURSOR',
          'Invalid cursor for this search',
        );
      }
    },
  };
}
