import { z } from 'zod';

export const publicQuerySchema = z.strictObject({
  q: z.string().trim().max(100).default(''),
  tag: z.string().trim().toLowerCase().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  cursor: z.string().min(1).max(2048).optional(),
});
export const publicGifSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  tags: z.array(z.string()),
  creator: z.object({ id: z.uuid(), displayName: z.string() }),
  posterUrl: z.string().regex(/^\/media\/[a-f0-9-]{36}\/poster\.png$/),
  displayUrl: z.string().regex(/^\/media\/[a-f0-9-]{36}\/display\.gif$/),
  createdAt: z.iso.datetime(),
});
export const publicDetailSchema = publicGifSchema.extend({
  description: z.string().nullable(),
  attribution: z.string(),
});
export const publicGifsSchema = z.object({
  items: z.array(publicGifSchema),
  nextCursor: z.string().optional(),
});
export type PublicQuery = z.infer<typeof publicQuerySchema>;
export type PublicGif = z.infer<typeof publicGifSchema>;
export type PublicDetail = z.infer<typeof publicDetailSchema>;
