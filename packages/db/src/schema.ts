import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  jsonb,
  primaryKey,
  unique,
  index,
  check,
  customType,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
const id = () => uuid('id').primaryKey().defaultRandom();
const time = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: time('created_at'),
  },
  (t) => [
    check('users_status_check', sql`${t.status} IN ('ACTIVE','DISABLED')`),
  ],
);

export const roleGrants = pgTable(
  'role_grants',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.role] }),
    check(
      'role_grants_role_check',
      sql`${t.role} IN ('UPLOADER','REVIEWER','ADMIN')`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique(),
    csrfTokenHash: bytea('csrf_token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: time('created_at'),
  },
  (t) => [
    index('sessions_valid_idx')
      .on(t.userId, t.expiresAt)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

export const assets = pgTable(
  'assets',
  {
    id: id(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    rightsAttestedAt: timestamp('rights_attested_at', {
      withTimezone: true,
    }).notNull(),
    rightsAttestationVersion: text('rights_attestation_version').notNull(),
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
    rowVersion: bigint('row_version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
  },
  (t) => [
    check('assets_kind_check', sql`${t.kind} IN ('GIF','STICKER')`),
    check('assets_title_check', sql`char_length(${t.title}) BETWEEN 1 AND 160`),
    check('assets_row_version_check', sql`${t.rowVersion} > 0`),
    index('assets_owner_created_idx').on(t.ownerId, t.createdAt.desc()),
  ],
);

export const tags = pgTable(
  'tags',
  { id: id(), slug: text('slug').notNull().unique() },
  (t) => [
    check(
      'tags_slug_check',
      sql`char_length(${t.slug}) BETWEEN 1 AND 64 AND ${t.slug} = lower(btrim(${t.slug}))`,
    ),
  ],
);
export const assetTags = pgTable(
  'asset_tags',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (t) => [
    primaryKey({ columns: [t.assetId, t.tagId] }),
    index('asset_tags_tag_idx').on(t.tagId, t.assetId),
  ],
);

export const assetStates = pgTable(
  'asset_states',
  {
    assetId: uuid('asset_id')
      .primaryKey()
      .references(() => assets.id, { onDelete: 'cascade' }),
    uploadState: text('upload_state').notNull().default('INTENT'),
    processingState: text('processing_state').notNull().default('NOT_STARTED'),
    visibilityState: text('visibility_state').notNull().default('PRIVATE'),
    searchEligibilityState: text('search_eligibility_state')
      .notNull()
      .default('INELIGIBLE'),
    indexingState: text('indexing_state').notNull().default('NOT_INDEXED'),
    apiAvailabilityState: text('api_availability_state')
      .notNull()
      .default('BLOCKED'),
    deliveryReadinessState: text('delivery_readiness_state')
      .notNull()
      .default('NOT_READY'),
    moderationState: text('moderation_state')
      .notNull()
      .default('NOT_REQUESTED'),
    processingErrorCode: text('processing_error_code'),
    stateUpdatedAt: time('state_updated_at'),
  },
  (t) => [
    check(
      'states_upload_state_check',
      sql`${t.uploadState} IN ('INTENT','RECEIVED','EXPIRED','FAILED')`,
    ),
    check(
      'states_processing_state_check',
      sql`${t.processingState} IN ('NOT_STARTED','QUEUED','RUNNING','SUCCEEDED','FAILED_RETRYABLE','FAILED_TERMINAL')`,
    ),
    check(
      'states_visibility_state_check',
      sql`${t.visibilityState} IN ('PRIVATE','PUBLIC','RESTRICTED')`,
    ),
    check(
      'states_search_eligibility_state_check',
      sql`${t.searchEligibilityState} IN ('INELIGIBLE','ELIGIBLE')`,
    ),
    check(
      'states_indexing_state_check',
      sql`${t.indexingState} IN ('NOT_INDEXED','INDEXED','STALE')`,
    ),
    check(
      'states_api_availability_state_check',
      sql`${t.apiAvailabilityState} IN ('BLOCKED','ENABLED')`,
    ),
    check(
      'states_delivery_readiness_state_check',
      sql`${t.deliveryReadinessState} IN ('NOT_READY','READY','DEGRADED')`,
    ),
    check(
      'states_moderation_state_check',
      sql`${t.moderationState} IN ('NOT_REQUESTED','PENDING','APPROVED','REJECTED','REMOVED')`,
    ),
    index('states_moderation_idx').on(t.moderationState, t.processingState),
  ],
);

export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: id(),
    assetId: uuid('asset_id')
      .notNull()
      .unique()
      .references(() => assets.id),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    idempotencyKey: text('idempotency_key').notNull(),
    quarantineKey: text('quarantine_key').notNull().unique(),
    requestedContentType: text('requested_content_type').notNull(),
    claimedSizeBytes: bigint('claimed_size_bytes', { mode: 'bigint' }),
    receivedSizeBytes: bigint('received_size_bytes', { mode: 'bigint' }),
    receivedEtag: text('received_etag'),
    receivedVersionId: text('received_version_id'),
    createdAt: time('created_at'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    unique('upload_sessions_owner_idempotency_unique').on(
      t.ownerId,
      t.idempotencyKey,
    ),
    check(
      'upload_sessions_idempotency_check',
      sql`char_length(${t.idempotencyKey}) BETWEEN 8 AND 128`,
    ),
    check(
      'upload_sessions_content_type_check',
      sql`${t.requestedContentType} = 'image/gif'`,
    ),
    check(
      'upload_sessions_sizes_check',
      sql`(${t.claimedSizeBytes} IS NULL OR ${t.claimedSizeBytes} > 0) AND (${t.receivedSizeBytes} IS NULL OR ${t.receivedSizeBytes} > 0)`,
    ),
    index('upload_sessions_exp_idx')
      .on(t.expiresAt)
      .where(sql`${t.completedAt} IS NULL`),
  ],
);

export const assetVariants = pgTable(
  'asset_variants',
  {
    id: id(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    renditionVersion: integer('rendition_version').notNull(),
    name: text('name').notNull(),
    objectKey: text('object_key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    durationMs: integer('duration_ms'),
    sha256: text('sha256').notNull(),
    createdAt: time('created_at'),
  },
  (t) => [
    unique('asset_variants_rendition_unique').on(
      t.assetId,
      t.renditionVersion,
      t.name,
    ),
    check('variants_version_check', sql`${t.renditionVersion} > 0`),
    check(
      'variants_name_check',
      sql`${t.name} IN ('DISPLAY_GIF','POSTER_PNG')`,
    ),
    check('variants_size_check', sql`${t.sizeBytes} > 0`),
    check('variants_width_check', sql`${t.width} > 0`),
    check('variants_height_check', sql`${t.height} > 0`),
  ],
);

export const moderationDecisions = pgTable(
  'moderation_decisions',
  {
    id: id(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    reasonCode: text('reason_code').notNull(),
    reasonNote: text('reason_note'),
    priorState: text('prior_state').notNull(),
    decidedAt: time('decided_at'),
  },
  (t) => [
    check(
      'moderation_action_check',
      sql`${t.action} IN ('APPROVE','REJECT','REMOVE')`,
    ),
    index('moderation_asset_time_idx').on(t.assetId, t.decidedAt.desc()),
  ],
);

export const searchDocuments = pgTable(
  'search_documents',
  {
    assetId: uuid('asset_id')
      .primaryKey()
      .references(() => assets.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    tagText: text('tag_text').notNull(),
    indexedAt: time('indexed_at'),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple',coalesce(title,'')),'A') || setweight(to_tsvector('simple',coalesce(tag_text,'')),'B')`,
    ),
  },
  (t) => [index('search_docs_fts_idx').using('gin', t.searchVector)],
);

export const mediaJobs = pgTable(
  'media_jobs',
  {
    id: id(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id),
    jobKind: text('job_kind').notNull(),
    generation: integer('generation').notNull().default(1),
    status: text('status').notNull().default('READY'),
    attemptCount: integer('attempt_count').notNull().default(0),
    availableAt: time('available_at'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    leaseToken: uuid('lease_token'),
    lastErrorCode: text('last_error_code'),
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
  },
  (t) => [
    unique('media_jobs_generation_unique').on(
      t.assetId,
      t.jobKind,
      t.generation,
    ),
    check('jobs_kind_check', sql`${t.jobKind} = 'PROCESS_GIF'`),
    check(
      'jobs_status_check',
      sql`${t.status} IN ('READY','RUNNING','DONE','DEAD')`,
    ),
    check('jobs_attempt_check', sql`${t.attemptCount} >= 0`),
    check('jobs_generation_check', sql`${t.generation} > 0`),
    index('jobs_due_idx').on(t.status, t.availableAt, t.leaseUntil),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    assetId: uuid('asset_id').references(() => assets.id),
    eventType: text('event_type').notNull(),
    requestId: text('request_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: time('created_at'),
  },
  (t) => [index('audit_asset_created_idx').on(t.assetId, t.createdAt.desc())],
);
