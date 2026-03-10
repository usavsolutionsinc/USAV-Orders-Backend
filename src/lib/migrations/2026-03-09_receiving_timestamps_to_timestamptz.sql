-- Convert naive timestamp columns in `receiving` to timezone-aware timestamptz.
-- Existing stored values were always written as America/Los_Angeles (PST/PDT),
-- so we reinterpret them as LA time before converting to UTC for storage.

ALTER TABLE receiving
  ALTER COLUMN date_time    TYPE timestamptz
    USING date_time    AT TIME ZONE 'America/Los_Angeles',
  ALTER COLUMN received_at  TYPE timestamptz
    USING received_at  AT TIME ZONE 'America/Los_Angeles',
  ALTER COLUMN unboxed_at   TYPE timestamptz
    USING unboxed_at   AT TIME ZONE 'America/Los_Angeles';

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'receiving'
  AND column_name IN ('date_time','received_at','unboxed_at')
ORDER BY column_name;
