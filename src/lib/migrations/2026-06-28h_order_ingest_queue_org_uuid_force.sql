-- ============================================================================
-- 2026-06-28h_order_ingest_queue_org_uuid_force.sql
--
-- order_ingest_queue.organization_id was TEXT, which blocked enforce_tenant_isolation
-- (its policy compares = current_setting(...)::uuid → "operator does not exist:
-- text = uuid"). The table is EMPTY (0 rows), so the TEXT→UUID conversion is
-- trivially safe (nothing to cast), and the sole enqueue writer
-- (api/zoho/orders/ingest) already passes a uuid-valued string (pg casts), so no
-- app change is needed. Then FORCE it. The global drain runs on the owner pool
-- (FORCE-inert) so the cross-org claim is unaffected.
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.order_ingest_queue') IS NULL THEN
    RAISE NOTICE 'skip order_ingest_queue (does not exist)'; RETURN;
  END IF;
  -- Empty-table guard: only alter the type if there are no rows (safety).
  IF (SELECT count(*) FROM order_ingest_queue) = 0 THEN
    ALTER TABLE order_ingest_queue
      ALTER COLUMN organization_id TYPE uuid USING NULLIF(organization_id, '')::uuid;
    PERFORM enforce_tenant_isolation('order_ingest_queue');
    RAISE NOTICE 'order_ingest_queue: organization_id → uuid + FORCEd';
  ELSE
    RAISE NOTICE 'order_ingest_queue: not empty — skipped type change (handle data first)';
  END IF;
END $$;
