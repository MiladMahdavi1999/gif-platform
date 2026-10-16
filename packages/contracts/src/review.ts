import { z } from 'zod';
import { assetStatesSchema } from './uploads.js';

// Provisional local operator taxonomy; this is not a final moderation policy.
export const rejectionReasons = [
  'POLICY_VIOLATION',
  'RIGHTS_CONCERN',
  'QUALITY_ISSUE',
  'OTHER',
] as const;
export const removalReasons = [
  'POLICY_VIOLATION',
  'RIGHTS_CONCERN',
  'RIGHTS_REQUEST',
  'OTHER',
] as const;
const fields = {
  reasonNote: z.string().trim().min(1).max(2000).optional(),
  expectedVersion: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
};
export const decisionRequestSchema = z.discriminatedUnion('decision', [
  z.strictObject({
    ...fields,
    decision: z.literal('APPROVE'),
    reasonCode: z.literal('POLICY_PASSED'),
  }),
  z.strictObject({
    ...fields,
    decision: z.literal('REJECT'),
    reasonCode: z.enum(rejectionReasons),
  }),
]);
export const removalRequestSchema = z.strictObject({
  ...fields,
  reasonCode: z.enum(removalReasons),
});
export const reviewQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(24),
  cursor: z.uuid().optional(),
});
export const reviewResultSchema = z.object({
  id: z.uuid(),
  states: assetStatesSchema,
  rowVersion: z.number().int().positive(),
});
export const reviewItemSchema = z.object({
  assetId: z.uuid(),
  title: z.string(),
  ownerId: z.uuid(),
  processing: assetStatesSchema.shape.processing,
  moderation: assetStatesSchema.shape.moderation,
  rowVersion: z.number().int().positive(),
});
export const reviewQueueSchema = z.object({
  items: z.array(reviewItemSchema),
  nextCursor: z.uuid().optional(),
});
export const reviewDetailSchema = reviewItemSchema.extend({
  tags: z.array(z.string()),
  states: assetStatesSchema,
  rightsAttested: z.boolean(),
  previews: z.array(
    z.object({
      variant: z.enum(['DISPLAY_GIF', 'POSTER_PNG']),
      path: z.string(),
    }),
  ),
  decisions: z.array(
    z.object({
      id: z.uuid(),
      reviewerId: z.uuid(),
      action: z.enum(['APPROVE', 'REJECT', 'REMOVE']),
      reasonCode: z.string(),
      reasonNote: z.string().nullable(),
      priorState: z.string(),
      decidedAt: z.iso.datetime(),
    }),
  ),
  audit: z.array(
    z.object({
      id: z.uuid(),
      eventType: z.string(),
      actorUserId: z.uuid().nullable(),
      createdAt: z.iso.datetime(),
      decisionId: z.uuid().nullable(),
    }),
  ),
});
export type ReviewDetail = z.infer<typeof reviewDetailSchema>;
export type ReviewItem = z.infer<typeof reviewItemSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
export type ReviewDecision = z.infer<typeof decisionRequestSchema>;
export type ReviewRemoval = z.infer<typeof removalRequestSchema>;
/** Internal storage descriptor; never serialized by reviewer HTTP responses. */
export interface ReviewVariant {
  name: 'DISPLAY_GIF' | 'POSTER_PNG';
  objectKey: string;
  objectVersionId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  frameCount: number | null;
  generation: number;
}
