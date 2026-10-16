-- DESTRUCTIVE development-only rollback; not a production down migration.
DROP FUNCTION IF EXISTS public.processing_request_review(uuid);
DROP TABLE IF EXISTS audit_events, media_jobs, search_documents,
  moderation_decisions, asset_variants, upload_sessions, asset_states,
  asset_tags, tags, assets, sessions, role_grants, users;
DROP FUNCTION IF EXISTS prevent_audit_mutation();
DROP TABLE IF EXISTS gif_migrations.history;
DROP SCHEMA IF EXISTS gif_migrations;
