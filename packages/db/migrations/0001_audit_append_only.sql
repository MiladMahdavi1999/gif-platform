-- Audit history cannot be rewritten through ordinary SQL, even by the table owner.
CREATE FUNCTION prevent_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_mutation
BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_mutation();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC;
