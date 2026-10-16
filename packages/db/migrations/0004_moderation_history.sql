-- Decisions, like audit events, preserve the full enforcement history.
CREATE FUNCTION prevent_moderation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'moderation_decisions is append-only' USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER moderation_decisions_no_mutation
BEFORE UPDATE OR DELETE OR TRUNCATE ON moderation_decisions
FOR EACH STATEMENT EXECUTE FUNCTION prevent_moderation_mutation();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON moderation_decisions FROM PUBLIC;
