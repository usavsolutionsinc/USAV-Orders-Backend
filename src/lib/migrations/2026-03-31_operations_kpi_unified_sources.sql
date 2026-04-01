BEGIN;

-- Normalize AUDIT + SAL into one deduped event stream for KPI rollups.
CREATE OR REPLACE VIEW operations_events_unified_v1 AS
WITH audit_events AS (
  SELECT
    al.id::bigint AS internal_id,
    al.created_at AS event_ts,
    'AUDIT'::text AS source_table,
    COALESCE(NULLIF(al.request_id, ''), 'audit:' || al.id::text) AS dedupe_key,
    COALESCE(NULLIF(al.request_id, ''), NULLIF(al.metadata->>'request_id', '')) AS request_id,
    COALESCE(NULLIF(al.source, ''), NULLIF(al.metadata->>'source', ''), 'unknown') AS source,
    al.action AS action_type,
    al.actor_staff_id,
    al.entity_type,
    al.entity_id,
    LOWER(COALESCE(NULLIF(al.metadata->>'severity', ''), '')) AS severity,
    COALESCE(sal.station, NULLIF(al.metadata->>'station', ''), NULL)::text AS station,
    al.station_activity_log_id
  FROM audit_logs al
  LEFT JOIN station_activity_logs sal ON sal.id = al.station_activity_log_id
),
sal_events AS (
  SELECT
    sal.id::bigint AS internal_id,
    sal.created_at AS event_ts,
    'SAL'::text AS source_table,
    COALESCE(
      NULLIF(sal.metadata->>'request_id', ''),
      'sal:' || sal.id::text
    ) AS dedupe_key,
    NULLIF(sal.metadata->>'request_id', '') AS request_id,
    COALESCE(NULLIF(sal.metadata->>'source', ''), LOWER(NULLIF(sal.station, '')), 'unknown') AS source,
    sal.activity_type AS action_type,
    sal.staff_id AS actor_staff_id,
    CASE
      WHEN sal.orders_exception_id IS NOT NULL THEN 'ORDERS_EXCEPTION'
      WHEN sal.fba_shipment_item_id IS NOT NULL THEN 'FBA_SHIPMENT_ITEM'
      WHEN sal.fba_shipment_id IS NOT NULL THEN 'FBA_SHIPMENT'
      WHEN sal.shipment_id IS NOT NULL THEN 'SHIPMENT'
      WHEN sal.tech_serial_number_id IS NOT NULL THEN 'TECH_SERIAL'
      WHEN sal.packer_log_id IS NOT NULL THEN 'PACKER_LOG'
      ELSE 'STATION_ACTIVITY'
    END AS entity_type,
    COALESCE(
      sal.orders_exception_id::text,
      sal.fba_shipment_item_id::text,
      sal.fba_shipment_id::text,
      sal.shipment_id::text,
      sal.tech_serial_number_id::text,
      sal.packer_log_id::text,
      sal.id::text
    ) AS entity_id,
    LOWER(COALESCE(NULLIF(sal.metadata->>'severity', ''), '')) AS severity,
    sal.station::text AS station,
    sal.id AS station_activity_log_id
  FROM station_activity_logs sal
  WHERE NOT EXISTS (
    SELECT 1
    FROM audit_logs al
    WHERE al.station_activity_log_id = sal.id
  )
),
combined AS (
  SELECT * FROM audit_events
  UNION ALL
  SELECT * FROM sal_events
),
ranked AS (
  SELECT
    c.*,
    ROW_NUMBER() OVER (
      PARTITION BY
        COALESCE(
          NULLIF(c.request_id, ''),
          NULLIF(c.dedupe_key, ''),
          (
            COALESCE(c.actor_staff_id::text, '-1')
            || '|'
            || COALESCE(c.action_type, '')
            || '|'
            || COALESCE(c.entity_type, '')
            || '|'
            || COALESCE(c.entity_id, '')
            || '|'
            || date_trunc('minute', c.event_ts)::text
          )
        )
      ORDER BY
        CASE WHEN c.source_table = 'AUDIT' THEN 0 ELSE 1 END,
        c.event_ts DESC,
        c.internal_id DESC
    ) AS dedupe_rank
  FROM combined c
)
SELECT
  source_table || ':' || internal_id::text AS event_id,
  event_ts,
  source_table,
  source,
  action_type,
  actor_staff_id,
  entity_type,
  entity_id,
  severity,
  station,
  station_activity_log_id,
  request_id
FROM ranked
WHERE dedupe_rank = 1;

-- Add state key for unified source processing; preserve old cursor when present.
INSERT INTO operations_kpi_rollup_state (key, last_processed_at)
VALUES (
  'operations_events',
  COALESCE(
    (SELECT s.last_processed_at FROM operations_kpi_rollup_state s WHERE s.key = 'audit_logs'),
    '1970-01-01 00:00:00+00'::timestamptz
  )
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION refresh_operations_kpi_rollups(
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
RETURNS TABLE (hourly_rows INTEGER, daily_rows INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_hourly_rows INTEGER := 0;
  v_daily_rows INTEGER := 0;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'refresh_operations_kpi_rollups requires non-null p_from and p_to';
  END IF;

  IF p_to <= p_from THEN
    RAISE EXCEPTION 'refresh_operations_kpi_rollups requires p_to > p_from (got %, %)', p_from, p_to;
  END IF;

  WITH unified AS (
    SELECT *
    FROM operations_events_unified_v1 u
    WHERE u.event_ts >= p_from
      AND u.event_ts < p_to
  ),
  hourly_agg AS (
    SELECT
      date_trunc('hour', event_ts) AS bucket_start,
      'prod'::text AS environment,
      source,
      action_type,
      COALESCE(actor_staff_id, -1) AS actor_staff_key,
      actor_staff_id,
      COUNT(*)::integer AS event_count,
      SUM(
        CASE
          WHEN severity = 'error'
            OR action_type ILIKE '%ERROR%'
            OR action_type ILIKE '%FAILED%'
            OR action_type ILIKE '%EXCEPTION%'
          THEN 1 ELSE 0
        END
      )::integer AS error_count,
      SUM(
        CASE
          WHEN severity = 'warning'
            OR action_type ILIKE '%WARN%'
            OR action_type ILIKE '%RETRY%'
            OR action_type ILIKE '%AT_RISK%'
          THEN 1 ELSE 0
        END
      )::integer AS warning_count,
      COUNT(DISTINCT (entity_type || ':' || entity_id)) FILTER (
        WHERE entity_type IS NOT NULL
          AND entity_type <> ''
          AND entity_id IS NOT NULL
          AND entity_id <> ''
      )::integer AS unique_entities,
      MIN(event_ts) AS first_event_at,
      MAX(event_ts) AS last_event_at
    FROM unified
    GROUP BY 1, 2, 3, 4, 5, 6
  ),
  upsert_hourly AS (
    INSERT INTO operations_kpi_rollups_hourly (
      bucket_start,
      environment,
      source,
      action_type,
      actor_staff_key,
      actor_staff_id,
      event_count,
      error_count,
      warning_count,
      unique_entities,
      first_event_at,
      last_event_at,
      updated_at
    )
    SELECT
      bucket_start,
      environment,
      source,
      action_type,
      actor_staff_key,
      actor_staff_id,
      event_count,
      error_count,
      warning_count,
      unique_entities,
      first_event_at,
      last_event_at,
      NOW()
    FROM hourly_agg
    ON CONFLICT (bucket_start, environment, source, action_type, actor_staff_key)
    DO UPDATE SET
      actor_staff_id = EXCLUDED.actor_staff_id,
      event_count = EXCLUDED.event_count,
      error_count = EXCLUDED.error_count,
      warning_count = EXCLUDED.warning_count,
      unique_entities = EXCLUDED.unique_entities,
      first_event_at = EXCLUDED.first_event_at,
      last_event_at = EXCLUDED.last_event_at,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*)::integer INTO v_hourly_rows FROM upsert_hourly;

  WITH unified AS (
    SELECT *
    FROM operations_events_unified_v1 u
    WHERE u.event_ts >= p_from
      AND u.event_ts < p_to
  ),
  daily_agg AS (
    SELECT
      date_trunc('day', event_ts)::date AS bucket_start,
      'prod'::text AS environment,
      source,
      action_type,
      COALESCE(actor_staff_id, -1) AS actor_staff_key,
      actor_staff_id,
      COUNT(*)::integer AS event_count,
      SUM(
        CASE
          WHEN severity = 'error'
            OR action_type ILIKE '%ERROR%'
            OR action_type ILIKE '%FAILED%'
            OR action_type ILIKE '%EXCEPTION%'
          THEN 1 ELSE 0
        END
      )::integer AS error_count,
      SUM(
        CASE
          WHEN severity = 'warning'
            OR action_type ILIKE '%WARN%'
            OR action_type ILIKE '%RETRY%'
            OR action_type ILIKE '%AT_RISK%'
          THEN 1 ELSE 0
        END
      )::integer AS warning_count,
      COUNT(DISTINCT (entity_type || ':' || entity_id)) FILTER (
        WHERE entity_type IS NOT NULL
          AND entity_type <> ''
          AND entity_id IS NOT NULL
          AND entity_id <> ''
      )::integer AS unique_entities,
      MIN(event_ts) AS first_event_at,
      MAX(event_ts) AS last_event_at
    FROM unified
    GROUP BY 1, 2, 3, 4, 5, 6
  ),
  upsert_daily AS (
    INSERT INTO operations_kpi_rollups_daily (
      bucket_start,
      environment,
      source,
      action_type,
      actor_staff_key,
      actor_staff_id,
      event_count,
      error_count,
      warning_count,
      unique_entities,
      first_event_at,
      last_event_at,
      updated_at
    )
    SELECT
      bucket_start,
      environment,
      source,
      action_type,
      actor_staff_key,
      actor_staff_id,
      event_count,
      error_count,
      warning_count,
      unique_entities,
      first_event_at,
      last_event_at,
      NOW()
    FROM daily_agg
    ON CONFLICT (bucket_start, environment, source, action_type, actor_staff_key)
    DO UPDATE SET
      actor_staff_id = EXCLUDED.actor_staff_id,
      event_count = EXCLUDED.event_count,
      error_count = EXCLUDED.error_count,
      warning_count = EXCLUDED.warning_count,
      unique_entities = EXCLUDED.unique_entities,
      first_event_at = EXCLUDED.first_event_at,
      last_event_at = EXCLUDED.last_event_at,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*)::integer INTO v_daily_rows FROM upsert_daily;

  RETURN QUERY SELECT v_hourly_rows, v_daily_rows;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_operations_kpi_rollups_from_state(
  p_to TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  from_ts TIMESTAMPTZ,
  to_ts TIMESTAMPTZ,
  hourly_rows INTEGER,
  daily_rows INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_from TIMESTAMPTZ;
  v_to TIMESTAMPTZ;
  v_hourly_rows INTEGER := 0;
  v_daily_rows INTEGER := 0;
BEGIN
  SELECT last_processed_at
    INTO v_from
  FROM operations_kpi_rollup_state
  WHERE key = 'operations_events'
  FOR UPDATE;

  IF v_from IS NULL THEN
    v_from := '1970-01-01 00:00:00+00'::timestamptz;
  END IF;

  v_to := COALESCE(p_to, NOW());

  IF v_to <= v_from THEN
    RETURN QUERY SELECT v_from, v_to, 0, 0;
    RETURN;
  END IF;

  SELECT r.hourly_rows, r.daily_rows
    INTO v_hourly_rows, v_daily_rows
  FROM refresh_operations_kpi_rollups(v_from, v_to) r;

  UPDATE operations_kpi_rollup_state
  SET last_processed_at = v_to,
      updated_at = NOW()
  WHERE key = 'operations_events';

  RETURN QUERY SELECT v_from, v_to, v_hourly_rows, v_daily_rows;
END;
$$;

COMMIT;
