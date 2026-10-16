ALTER TABLE "asset_variants" ADD COLUMN "object_version_id" text;--> statement-breakpoint
ALTER TABLE "asset_variants" ADD COLUMN "frame_count" integer;--> statement-breakpoint
-- The restricted worker cannot UPDATE moderation_state. Its only review command is fixed PENDING.
CREATE FUNCTION public.processing_request_review(target uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  UPDATE public.asset_states SET moderation_state='PENDING'
  WHERE asset_id=target AND processing_state='SUCCEEDED' AND moderation_state='NOT_REQUESTED'
    AND (SELECT count(DISTINCT name) FROM public.asset_variants WHERE asset_id=target)=2;
$$;
REVOKE ALL ON FUNCTION public.processing_request_review(uuid) FROM PUBLIC;
