BEGIN;

-- Canonical state cursor for incremental rollup jobs.
CREATE TABLE IF NOT EXISTS operations_kpi_rollup_state (
  key TEXT PRIMARY KEY,
  last_processed_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01 00:00:00+00',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO operations_kpi_rollup_state (key, last_processed_at)
VALUES ('audit_logs', '1970-01-01 00:00:00+00')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS operations_kpi_rollups_hourly (
  bucket_start TIMESTAMPTZ NOT NULL,
  environment TEXT NOT NULL DEFAULT 'prod',
  source TEXT NOT NULL,
  action_type TEXT NOT NULL,
  actor_staff_key INTEGER NOT NULL DEFAULT -1,
  actor_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  unique_entities INTEGER NOT NULL DEFAULT 0,
  first_event_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket_start, environment, source, action_type, actor_staff_key),
  CONSTRAINT chk_operations_kpi_hourly_actor_key
    CHECK (actor_staff_key = COALESCE(actor_staff_id, -1))
);

CREATE TABLE IF NOT EXISTS operations_kpi_rollups_daily (
  bucket_start DATE NOT NULL,
  environment TEXT NOT NULL DEFAULT 'prod',
  source TEXT NOT NULL,
  action_type TEXT NOT NULL,
  actor_staff_key INTEGER NOT NULL DEFAULT -1,
  actor_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  unique_entities INTEGER NOT NULL DEFAULT 0,
  first_event_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket_start, environment, source, action_type, actor_staff_key),
  CONSTRAINT chk_operations_kpi_daily_actor_key
    CHECK (actor_staff_key = COALESCE(actor_staff_id, -1))
);

CREATE INDEX IF NOT EXISTS idx_operations_kpi_hourly_bucket_desc
  ON operations_kpi_rollups_hourly (bucket_start DESC);
CREATE INDEX IF NOT EXISTS idx_operations_kpi_hourly_env_bucket_desc
  ON operations_kpi_rollups_hourly (environment, bucket_start DESC);
CREATE INDEX IF NOT EXISTS idx_operations_kpi_hourly_source_bucket_desc
  ON operations_kpi_rollups_hourly (source, bucket_start DESC);
CREATE INDEX IF NOT EXISTS idx_operations_kpi_hourly_actor_bucket_desc
  ON operations_kpi_rollups_hourly (actor_staff_id, bucket_start DESC);

CREATE INDEX IF NOT EXISTS idx_operations_kpi_daily_bucket_desc
  ON operations_kpi_rollups_daily (bucket_start DESC);
CREATE INDEX IF NOT EXISTS idx_operations_kpi_daily_env_bucket_desc
  ON operations_kpi_rollups_daily (environment, bucket_start DESC);
CREATE INDEX IF NOT EXISTS idx_operations_kpi_daily_source_bucket_desc
  ON operations_kpi_rollups_daily (source, bucket_start DESC);
CREATE INDEX IF NOT EXISTS idx_operations_kpi_daily_actor_bucket_desc
  ON operations_kpi_rollups_daily (actor_staff_id, bucket_start DESC);

-- Recompute rollups over an explicit time window.
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

  WITH audit_base AS (
    SELECT
      date_trunc('hour', al.created_at) AS hour_bucket,
      date_trunc('day', al.created_at)::date AS day_bucket,
      'prod'::text AS environment,
      COALESCE(NULLIF(al.source, ''), NULLIF(al.metadata->>'source', ''), 'unknown') AS source,
      al.action AS action_type,
      al.actor_staff_id,
      al.created_at,
      al.entity_type,
      al.entity_id,
      lower(COALESCE(al.metadata->>'severity', '')) AS severity
    FROM audit_logs al
    WHERE al.created_at >= p_from
      AND al.created_at < p_to
  ),
  hourly_agg AS (
    SELECT
      hour_bucket AS bucket_start,
      environment,
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
      MIN(created_at) AS first_event_at,
      MAX(created_at) AS last_event_at
    FROM audit_base
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

  WITH audit_base AS (
    SELECT
      date_trunc('day', al.created_at)::date AS day_bucket,
      'prod'::text AS environment,
      COALESCE(NULLIF(al.source, ''), NULLIF(al.metadata->>'source', ''), 'unknown') AS source,
      al.action AS action_type,
      al.actor_staff_id,
      al.created_at,
      al.entity_type,
      al.entity_id,
      lower(COALESCE(al.metadata->>'severity', '')) AS severity
    FROM audit_logs al
    WHERE al.created_at >= p_from
      AND al.created_at < p_to
  ),
  daily_agg AS (
    SELECT
      day_bucket AS bucket_start,
      environment,
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
      MIN(created_at) AS first_event_at,
      MAX(created_at) AS last_event_at
    FROM audit_base
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

-- Cursor-based refresh helper for scheduled jobs.
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
  WHERE key = 'audit_logs'
  FOR UPDATE;

  IF v_from IS NULL THEN
    v_from := '1970-01-01 00:00:00+00'::timestamptz;
  END IF;

  v_to := p_to;
  IF v_to IS NULL THEN
    v_to := NOW();
  END IF;

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
  WHERE key = 'audit_logs';

  RETURN QUERY SELECT v_from, v_to, v_hourly_rows, v_daily_rows;
END;
$$;

COMMIT;
