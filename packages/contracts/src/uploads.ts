import { z } from 'zod';

export const uploadRequestSchema = z.strictObject({
  kind: z.literal('GIF'),
  title: z.string().trim().min(1).max(160),
  tags: z
    .array(z.string().trim().toLowerCase().min(1).max(64))
    .max(10)
    .refine((tags) => new Set(tags).size === tags.length, 'Duplicate tags'),
  rightsAttested: z.literal(true),
  rightsAttestationVersion: z.literal('v1'),
  claimedSizeBytes: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
});
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
export const completeRequestSchema = z.strictObject({});
export const assetIdSchema = z.uuid();
export const assetStatesSchema = z.object({
  upload: z.enum(['INTENT', 'RECEIVED', 'EXPIRED', 'FAILED']),
  processing: z.enum([
    'NOT_STARTED',
    'QUEUED',
    'RUNNING',
    'SUCCEEDED',
    'FAILED_RETRYABLE',
    'FAILED_TERMINAL',
  ]),
  visibility: z.enum(['PRIVATE', 'PUBLIC', 'RESTRICTED']),
  searchEligibility: z.enum(['INELIGIBLE', 'ELIGIBLE']),
  indexing: z.enum(['NOT_INDEXED', 'INDEXED', 'STALE']),
  apiAvailability: z.enum(['BLOCKED', 'ENABLED']),
  deliveryReadiness: z.enum(['NOT_READY', 'READY', 'DEGRADED']),
  moderation: z.enum([
    'NOT_REQUESTED',
    'PENDING',
    'APPROVED',
    'REJECTED',
    'REMOVED',
  ]),
});
export const uploadIntentSchema = z.object({
  assetId: z.uuid(),
  uploadId: z.uuid(),
  expiresAt: z.iso.datetime(),
  method: z.literal('POST'),
  form: z.object({ url: z.url(), fields: z.record(z.string(), z.string()) }),
  state: assetStatesSchema.pick({ upload: true, processing: true }),
});
export const uploadCompletionSchema = z.object({
  assetId: z.uuid(),
  upload: assetStatesSchema.shape.upload,
  processing: assetStatesSchema.shape.processing,
});
export const ownerAssetSchema = z.object({
  assetId: z.uuid(),
  title: z.string(),
  tags: z.array(z.string()),
  states: assetStatesSchema,
  createdAt: z.iso.datetime(),
  variantsReady: z.boolean(),
  rowVersion: z.number().int().positive(),
  errorCode: z.string().optional(),
});
export const ownerAssetsSchema = z.object({
  items: z.array(
    ownerAssetSchema.omit({ assetId: true }).extend({ id: z.uuid() }),
  ),
  nextCursor: z.uuid().optional(),
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;
export type UploadIntent = z.infer<typeof uploadIntentSchema>;
export type OwnerAsset = z.infer<typeof ownerAssetSchema>;
