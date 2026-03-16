-- Durable realtime foundation for repair_service.
-- Phase 1 only: do not roll this out to every table yet.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS realtime_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_name text NOT NULL DEFAULT 'public',
  table_name text NOT NULL,
  pk jsonb NOT NULL,
  op text NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  version integer,
  actor_staff_id integer,
  payload jsonb,
  needs_refetch boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token uuid,
  sent_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX IF NOT EXISTS idx_realtime_outbox_unsent
  ON realtime_outbox (sent_at, claimed_at, created_at)
  WHERE sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_realtime_outbox_table_created
  ON realtime_outbox (table_name, created_at DESC);

ALTER TABLE repair_service
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by_staff_id integer REFERENCES staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_repair_service_updated_at
  ON repair_service (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_repair_service_version
  ON repair_service (version);

CREATE OR REPLACE FUNCTION fn_realtime_set_updated_meta()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.version = COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_realtime_enqueue_outbox()
RETURNS TRIGGER AS $$
DECLARE
  row_payload jsonb;
  row_pk jsonb;
  row_version integer;
  actor_staff integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_payload := NULL;
    row_pk := jsonb_build_object('id', OLD.id);
    row_version := OLD.version;
    actor_staff := OLD.updated_by_staff_id;
  ELSE
    row_payload := to_jsonb(NEW);
    row_pk := jsonb_build_object('id', NEW.id);
    row_version := NEW.version;
    actor_staff := NEW.updated_by_staff_id;
  END IF;

  INSERT INTO realtime_outbox (
    schema_name,
    table_name,
    pk,
    op,
    version,
    actor_staff_id,
    payload,
    needs_refetch
  ) VALUES (
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME,
    row_pk,
    TG_OP,
    row_version,
    actor_staff,
    CASE
      WHEN row_payload IS NULL THEN NULL
      WHEN pg_column_size(row_payload::text) > 7000 THEN NULL
      ELSE row_payload
    END,
    CASE
      WHEN row_payload IS NULL THEN false
      WHEN pg_column_size(row_payload::text) > 7000 THEN true
      ELSE false
    END
  );

  PERFORM pg_notify(
    'realtime_outbox',
    json_build_object(
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA
    )::text
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_repair_service_set_updated_meta ON repair_service;
CREATE TRIGGER trg_repair_service_set_updated_meta
  BEFORE UPDATE ON repair_service
  FOR EACH ROW
  EXECUTE FUNCTION fn_realtime_set_updated_meta();

DROP TRIGGER IF EXISTS trg_repair_service_realtime_outbox_insert ON repair_service;
CREATE TRIGGER trg_repair_service_realtime_outbox_insert
  AFTER INSERT ON repair_service
  FOR EACH ROW
  EXECUTE FUNCTION fn_realtime_enqueue_outbox();

DROP TRIGGER IF EXISTS trg_repair_service_realtime_outbox_update ON repair_service;
CREATE TRIGGER trg_repair_service_realtime_outbox_update
  AFTER UPDATE ON repair_service
  FOR EACH ROW
  EXECUTE FUNCTION fn_realtime_enqueue_outbox();

DROP TRIGGER IF EXISTS trg_repair_service_realtime_outbox_delete ON repair_service;
CREATE TRIGGER trg_repair_service_realtime_outbox_delete
  AFTER DELETE ON repair_service
  FOR EACH ROW
  EXECUTE FUNCTION fn_realtime_enqueue_outbox();

COMMIT;
