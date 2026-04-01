-- Add 'FBA' to the source_stage check constraint on fba_fnsku_logs.
-- The FBA workspace scan route uses source_stage='FBA' to distinguish
-- FBA-origin FNSKU scans from tech-station scans.

ALTER TABLE fba_fnsku_logs
  DROP CONSTRAINT IF EXISTS fba_fnsku_logs_source_stage_check;

ALTER TABLE fba_fnsku_logs
  ADD CONSTRAINT fba_fnsku_logs_source_stage_check
  CHECK (source_stage IN ('TECH', 'PACK', 'SHIP', 'ADMIN', 'FBA'));

-- Also widen the event_type constraint to include values used by createFbaLog.
ALTER TABLE fba_fnsku_logs
  DROP CONSTRAINT IF EXISTS fba_fnsku_logs_event_type_check;

ALTER TABLE fba_fnsku_logs
  ADD CONSTRAINT fba_fnsku_logs_event_type_check
  CHECK (event_type IN (
    'SCANNED', 'READY', 'VERIFIED', 'BOXED', 'ASSIGNED',
    'SHIPPED', 'UNASSIGNED', 'VOID', 'LABEL_ASSIGNED', 'PACKER_VERIFIED'
  ));
