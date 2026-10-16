CREATE TABLE "asset_states" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"upload_state" text DEFAULT 'INTENT' NOT NULL,
	"processing_state" text DEFAULT 'NOT_STARTED' NOT NULL,
	"visibility_state" text DEFAULT 'PRIVATE' NOT NULL,
	"search_eligibility_state" text DEFAULT 'INELIGIBLE' NOT NULL,
	"indexing_state" text DEFAULT 'NOT_INDEXED' NOT NULL,
	"api_availability_state" text DEFAULT 'BLOCKED' NOT NULL,
	"delivery_readiness_state" text DEFAULT 'NOT_READY' NOT NULL,
	"moderation_state" text DEFAULT 'NOT_REQUESTED' NOT NULL,
	"processing_error_code" text,
	"state_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "states_upload_state_check" CHECK ("asset_states"."upload_state" IN ('INTENT','RECEIVED','EXPIRED','FAILED')),
	CONSTRAINT "states_processing_state_check" CHECK ("asset_states"."processing_state" IN ('NOT_STARTED','QUEUED','RUNNING','SUCCEEDED','FAILED_RETRYABLE','FAILED_TERMINAL')),
	CONSTRAINT "states_visibility_state_check" CHECK ("asset_states"."visibility_state" IN ('PRIVATE','PUBLIC','RESTRICTED')),
	CONSTRAINT "states_search_eligibility_state_check" CHECK ("asset_states"."search_eligibility_state" IN ('INELIGIBLE','ELIGIBLE')),
	CONSTRAINT "states_indexing_state_check" CHECK ("asset_states"."indexing_state" IN ('NOT_INDEXED','INDEXED','STALE')),
	CONSTRAINT "states_api_availability_state_check" CHECK ("asset_states"."api_availability_state" IN ('BLOCKED','ENABLED')),
	CONSTRAINT "states_delivery_readiness_state_check" CHECK ("asset_states"."delivery_readiness_state" IN ('NOT_READY','READY','DEGRADED')),
	CONSTRAINT "states_moderation_state_check" CHECK ("asset_states"."moderation_state" IN ('NOT_REQUESTED','PENDING','APPROVED','REJECTED','REMOVED'))
);
--> statement-breakpoint
CREATE TABLE "asset_tags" (
	"asset_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "asset_tags_asset_id_tag_id_pk" PRIMARY KEY("asset_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "asset_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"rendition_version" integer NOT NULL,
	"name" text NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"duration_ms" integer,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_variants_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "asset_variants_rendition_unique" UNIQUE("asset_id","rendition_version","name"),
	CONSTRAINT "variants_version_check" CHECK ("asset_variants"."rendition_version" > 0),
	CONSTRAINT "variants_name_check" CHECK ("asset_variants"."name" IN ('DISPLAY_GIF','POSTER_PNG')),
	CONSTRAINT "variants_size_check" CHECK ("asset_variants"."size_bytes" > 0),
	CONSTRAINT "variants_width_check" CHECK ("asset_variants"."width" > 0),
	CONSTRAINT "variants_height_check" CHECK ("asset_variants"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"rights_attested_at" timestamp with time zone NOT NULL,
	"rights_attestation_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "assets_kind_check" CHECK ("assets"."kind" IN ('GIF','STICKER')),
	CONSTRAINT "assets_title_check" CHECK (char_length("assets"."title") BETWEEN 1 AND 160),
	CONSTRAINT "assets_row_version_check" CHECK ("assets"."row_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"asset_id" uuid,
	"event_type" text NOT NULL,
	"request_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"job_kind" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'READY' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"lease_token" uuid,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_jobs_generation_unique" UNIQUE("asset_id","job_kind","generation"),
	CONSTRAINT "jobs_kind_check" CHECK ("media_jobs"."job_kind" = 'PROCESS_GIF'),
	CONSTRAINT "jobs_status_check" CHECK ("media_jobs"."status" IN ('READY','RUNNING','DONE','DEAD')),
	CONSTRAINT "jobs_attempt_check" CHECK ("media_jobs"."attempt_count" >= 0),
	CONSTRAINT "jobs_generation_check" CHECK ("media_jobs"."generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "moderation_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason_note" text,
	"prior_state" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_action_check" CHECK ("moderation_decisions"."action" IN ('APPROVE','REJECT','REMOVE'))
);
--> statement-breakpoint
CREATE TABLE "role_grants" (
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "role_grants_user_id_role_pk" PRIMARY KEY("user_id","role"),
	CONSTRAINT "role_grants_role_check" CHECK ("role_grants"."role" IN ('UPLOADER','REVIEWER','ADMIN'))
);
--> statement-breakpoint
CREATE TABLE "search_documents" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"tag_text" text NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple',coalesce(title,'')),'A') || setweight(to_tsvector('simple',coalesce(tag_text,'')),'B')) STORED
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"csrf_token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tags_slug_check" CHECK (char_length("tags"."slug") BETWEEN 1 AND 64 AND "tags"."slug" = lower(btrim("tags"."slug")))
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"quarantine_key" text NOT NULL,
	"requested_content_type" text NOT NULL,
	"claimed_size_bytes" bigint,
	"received_size_bytes" bigint,
	"received_etag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "upload_sessions_asset_id_unique" UNIQUE("asset_id"),
	CONSTRAINT "upload_sessions_quarantine_key_unique" UNIQUE("quarantine_key"),
	CONSTRAINT "upload_sessions_owner_idempotency_unique" UNIQUE("owner_id","idempotency_key"),
	CONSTRAINT "upload_sessions_idempotency_check" CHECK (char_length("upload_sessions"."idempotency_key") BETWEEN 8 AND 128),
	CONSTRAINT "upload_sessions_content_type_check" CHECK ("upload_sessions"."requested_content_type" = 'image/gif'),
	CONSTRAINT "upload_sessions_sizes_check" CHECK (("upload_sessions"."claimed_size_bytes" IS NULL OR "upload_sessions"."claimed_size_bytes" > 0) AND ("upload_sessions"."received_size_bytes" IS NULL OR "upload_sessions"."received_size_bytes" > 0))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_status_check" CHECK ("users"."status" IN ('ACTIVE','DISABLED'))
);
--> statement-breakpoint
ALTER TABLE "asset_states" ADD CONSTRAINT "asset_states_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tags" ADD CONSTRAINT "asset_tags_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tags" ADD CONSTRAINT "asset_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_variants" ADD CONSTRAINT "asset_variants_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "states_moderation_idx" ON "asset_states" USING btree ("moderation_state","processing_state");--> statement-breakpoint
CREATE INDEX "asset_tags_tag_idx" ON "asset_tags" USING btree ("tag_id","asset_id");--> statement-breakpoint
CREATE INDEX "assets_owner_created_idx" ON "assets" USING btree ("owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_asset_created_idx" ON "audit_events" USING btree ("asset_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "media_jobs" USING btree ("status","available_at","lease_until");--> statement-breakpoint
CREATE INDEX "moderation_asset_time_idx" ON "moderation_decisions" USING btree ("asset_id","decided_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "search_docs_fts_idx" ON "search_documents" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "sessions_valid_idx" ON "sessions" USING btree ("user_id","expires_at") WHERE "sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "upload_sessions_exp_idx" ON "upload_sessions" USING btree ("expires_at") WHERE "upload_sessions"."completed_at" IS NULL;