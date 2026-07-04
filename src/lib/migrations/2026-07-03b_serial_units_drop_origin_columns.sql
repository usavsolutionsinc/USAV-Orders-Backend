-- ============================================================================
-- 2026-07-03b: serial_units — Phase 4 DROP of the origin_* denorm family
-- ============================================================================
-- ⚠️  BLOCKED / UNAPPLIED ON PURPOSE — and the block is now a DEPLOY GATE, not a
--     code gate. The code migration is COMPLETE + verified (2026-07-03): all
--     readers read provenance/view, all writers write provenance app-side, the
--     write path smoke-tested (INSERT without origin_*, first-wins edge, view
--     reconstruction). tsc clean, 20 unit tests pass, live parity 0 mismatches.
--
--     THE ONLY REASON THIS IS STILL BLOCKED: the migrated code is UNCOMMITTED /
--     UNDEPLOYED. Production currently runs commit 2b39d809, whose old readers
--     AND writers reference serial_units.origin_*. Applying this DROP against the
--     shared production DB now would instantly 500 every receiving/testing/
--     journey/photo/handling-unit endpoint on the LIVE deployment. So it must be
--     applied ONLY in this exact order:
--       1. commit + deploy this branch (all 24 migrated files) to production,
--       2. verify the deployed app (receiving scan, tech verdict, unit detail),
--       3. THEN rename this file `.BLOCKED` → `.sql` and run the migration.
--     The runner globs `*.sql`, so the `.BLOCKED` suffix keeps it un-fireable
--     until step 3. This is Phase 4 of
--     docs/todo/schema-wide-polymorphic-refactor-plan.md ("Serial Units").
--
-- WHAT THIS DROPS:
--   serial_units.origin_source            (text)
--   serial_units.origin_receiving_line_id (int FK → receiving_lines)
--   serial_units.origin_tsn_id            (int soft-link)
--   serial_units.origin_sku_id            (int soft-link)
--   + fn_sync_serial_unit_provenance / trg_sync_serial_unit_provenance (Phase 2
--     dual-write trigger — its source columns are gone, so writes must already
--     be app-side by the time this runs).
--
-- WHY IT IS GATED (do not skip):
--   `origin_receiving_line_id` is NOT vestigial provenance — it is a LOAD-BEARING
--   functional FK. ~20 live query paths read it, most as the frozen fallback in
--   COALESCE(current_receiving_line_id, origin_receiving_line_id) "which line does
--   this unit resolve to". These are raw SQL strings in TS template literals:
--   `tsc` does NOT typecheck them and the unit tests only regex the SQL *shape*.
--   A single wrong rewrite silently returns the WRONG receiving line for a unit
--   across testing scans, journey timelines, photo→line joins, and handling-unit
--   grouping — corruption that passes CI. The plan's own Phase-4 gate requires
--   "grep proves zero readers + full test suite + e2e + data-parity report".
--
-- ────────────────────────────────────────────────────────────────────────────
-- RECONSTRUCTION FOUNDATION (built + parity-proven 2026-07-03):
--   View `v_serial_unit_origins` (2026-07-03c) reconstructs all four origin_*
--   fields from serial_unit_provenance. Verified against live data: the three id
--   columns match the base columns with **0 mismatches across 1130 units**
--   (lossless). `origin_source` is a SEMANTIC label (327 'legacy_tsn_backfill'
--   rows read back as 'tsn'/'receiving') — display-only, accepted.
--
-- HOW TO MIGRATE EACH READER (pick by read type — do NOT blindly view-join):
--   • AUGMENT read (you already have the serial_units row and want its origin):
--       JOIN v_serial_unit_origins vo ON vo.serial_unit_id = su.id
--       then read vo.origin_receiving_line_id / vo.origin_tsn_id / vo.origin_source.
--   • FILTER-BY-ORIGIN read (WHERE su.origin_receiving_line_id = $1 / = ANY):
--       do NOT view-join (the view runs 4 correlated subqueries/row). Instead use
--       the indexed reverse lookup (idx_serial_unit_provenance_origin):
--         WHERE su.id IN (SELECT p.serial_unit_id FROM serial_unit_provenance p
--                          WHERE p.origin_type='RECEIVING_LINE' AND p.origin_id=$1
--                            AND p.organization_id = <orgParam>)
--   • Verify EACH rewrite with an old-vs-new SQL parity run on live data before
--     committing (same technique as 2026-07-03c's parity check — identical rows).
--
-- ✅ READER MIGRATION COMPLETE 2026-07-03 (plan-literal: all 4 columns). Every
-- reader below now reads from v_serial_unit_origins (augment) or an indexed
-- serial_unit_provenance subquery (filter-by-origin). Verified: tsc clean, 25
-- unit tests pass, live parity 0 mismatches, and `rg` finds zero remaining raw
-- `su.origin_*` reads. WRITE SIDE ALSO COMPLETE 2026-07-03 (verified):
--   [x] serial-units-queries.ts upsertSerialUnit INSERT/UPDATE — origin_* removed;
--       recordOriginProvenance() (exported, first-wins per type via NOT EXISTS,
--       ON CONFLICT) writes edges app-side after INSERT and after UPDATE.
--   [x] app/api/receiving/mark-received/route.ts fallback INSERT — origin_* removed;
--       recordOriginProvenance() called after (RECEIVING_LINE).
--   [x] tech/insertTechSerialForTracking.ts INSERT — origin_source/origin_tsn_id
--       removed; recordOriginProvenance() writes the TECH_SERIAL edge.
--   [x] fn_sync_serial_unit_provenance + trigger dropped by THIS migration (below);
--       app-side writes replace it. Harmless no-op in the deploy window (origin_*
--       no longer appear in any INSERT/UPDATE, so AFTER UPDATE OF never fires).
--   [x] SerialUnitRow: 4 origin_* fields removed. UpsertSerialUnitInput KEEPS them
--       (write API → provenance). Drizzle serialUnits de-columned. tsc clean.
--   [x] SELECT-* callers verified (tsc caught + fixed the one receiving-lines typing).
--   Verification: tsc clean · 20 unit tests pass · live write smoke test (INSERT
--   w/o origin_*, first-wins edge, view reconstruction) · live parity 0 mismatches.
--
-- COMPLETED reader sites (for the record):
--
--   origin_receiving_line_id (functional — COALESCE-with-current-line):
--     [ ] src/lib/testing/resolve-testing-scan.ts:253
--     [ ] src/lib/operations/journey.ts:251
--     [ ] src/lib/neon/serial-units-queries.ts:456 (+ 486/494/510/518 WHERE-by-line)
--     [ ] src/app/api/receiving-lines/route.ts:42,68,71,92,713,1869
--     [ ] src/lib/neon/handling-unit-queries.ts:75,239
--     [ ] src/lib/photos/queries/library.ts:191 (JOIN)
--     [ ] src/lib/zendesk-claim-template.ts:159,177
--     [ ] src/lib/audit-log/tech-aggregator.ts:382,385,392
--     [ ] src/app/api/receiving/[id]/route.ts:210,212,218
--     [ ] src/app/api/receiving/mark-received-po/route.ts:560,562,569
--     [ ] src/lib/receiving/serial-attach.ts:152,326,332 (WHERE-by-line find)
--     [ ] src/lib/receiving/receive-line.ts:292 (WHERE-by-line find)
--     [ ] src/lib/receiving/line-catalog.ts:81,92 (WHERE-by-line find)
--     [ ] src/app/api/serial-units/[id]/route.ts:39 (select)  + test/route.ts:103,134
--
--   origin_source (provenance display / defaultStatusForSource):
--     [ ] src/lib/audit-log/trace-aggregator.ts:114,163,244
--     [ ] src/components/audit-log/AuditLogTraceClient.tsx (+ types)
--     [ ] src/components/labels/unit-detail/cards.tsx:123 (+ types.ts)
--     [ ] src/components/inventory/ByUnitView.tsx:143,147,148 (+ types.ts)
--     [ ] src/app/serial/[id]/page.tsx, src/app/m/(shell)/h/[id]/page.tsx (types)
--     NOTE: defaultStatusForSource(input.origin_source) in serial-units-queries.ts
--           stays app-side — it reads the WRITE input, not the column; unaffected.
--
--   origin_tsn_id:
--     [ ] src/lib/tech/insertTechSerialForTracking.ts:47,53 (ON CONFLICT COALESCE
--         write — move to an app-side provenance INSERT of ('TECH_SERIAL', tsn.id))
--     [ ] src/components/inventory/ByUnitView.tsx:148 (display)
--
--   origin_sku_id:
--     [ ] src/app/api/sku/by-tracking/route.ts:171 (DELETE ... WHERE origin_sku_id
--         — re-anchor to the SKU_IMPORT provenance edge, or drop the legacy branch)
--
--   WRITE SITES (move the origin_* writes to a direct serial_unit_provenance
--   INSERT so the Phase-2 trigger is no longer needed):
--     [ ] src/lib/neon/serial-units-queries.ts:627 INSERT + 694-697 UPDATE
--     [ ] src/app/api/receiving/mark-received/route.ts:188
--     [ ] src/lib/tech/insertTechSerialForTracking.ts:45
--
--   THEN: update src/lib/drizzle/schema.ts `serialUnits` (remove originSource/
--   originReceivingLineId/originTsnId/originSkuId) and drop those fields from the
--   *Row / *Input interfaces + fixtures in serial-units-queries.ts, unit-events.ts,
--   and the component `types.ts` files.
-- ────────────────────────────────────────────────────────────────────────────
--
-- ROLLBACK (columns are additive to re-create, but the FK + data are not
-- recoverable once dropped — restore from backup / re-derive from
-- serial_unit_provenance):
--   ALTER TABLE serial_units
--     ADD COLUMN origin_source text,
--     ADD COLUMN origin_receiving_line_id integer REFERENCES receiving_lines(id),
--     ADD COLUMN origin_tsn_id integer,
--     ADD COLUMN origin_sku_id integer;
--   -- then re-derive from serial_unit_provenance (RECEIVING_LINE→origin_receiving_line_id, …)
-- ============================================================================

BEGIN;

-- ── Redefine the two VIEWS that still depend on the origin_* columns (surfaced
--    by the drop's dependency check — they are DB objects, not code readers). ──

-- v_unfound_queue: the serial_units join by origin line → provenance edge. (This
-- branch only ever surfaces receiving rows with NO lines, so the join is
-- effectively empty anyway, but the column dependency must go.)
CREATE OR REPLACE VIEW v_unfound_queue AS
 SELECT 'unmatched_receiving'::text AS kind,
    r.id::text AS source_id,
    r.organization_id,
    NULLIF(string_agg(rl.item_name, ' | '::text), ''::text) AS product_title,
    NULLIF(string_agg(su.serial_number, ', '::text), ''::text) AS serial_numbers,
    stn.tracking_number_raw AS context,
    r.receiving_date_time AS created_at,
    ov.zendesk_ticket_id,
    ov.zendesk_synced_at,
    ov.usa_team_note,
    ov.vietnam_team_note,
    ov.follow_up_at,
    COALESCE(ov.checked, false) AS checked,
    ov.checked_at
   FROM receiving r
     LEFT JOIN receiving_lines rl ON rl.receiving_id = r.id
     LEFT JOIN serial_unit_provenance sup ON sup.origin_type = 'RECEIVING_LINE'
        AND sup.origin_id = rl.id AND sup.organization_id = r.organization_id
     LEFT JOIN serial_units su ON su.id = sup.serial_unit_id
     LEFT JOIN unfound_overlay ov ON ov.source_kind = 'unmatched_receiving'::text AND ov.source_id = r.id::text AND ov.organization_id = r.organization_id
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
  WHERE r.source = 'unmatched'::text AND NOT (EXISTS ( SELECT 1
           FROM receiving_lines rl2
          WHERE rl2.receiving_id = r.id)) AND r.unboxed_at IS NULL
  GROUP BY r.id, r.organization_id, stn.tracking_number_raw, r.receiving_date_time, ov.zendesk_ticket_id, ov.zendesk_synced_at, ov.usa_team_note, ov.vietnam_team_note, ov.follow_up_at, ov.checked, ov.checked_at
UNION ALL
 SELECT 'email_po'::text AS kind,
    empo.id::text AS source_id,
    empo.organization_id,
    NULL::text AS product_title,
    NULL::text AS serial_numbers,
        CASE
            WHEN COALESCE(array_length(empo.po_numbers, 1), 0) > 0 THEN (COALESCE(empo.email_subject, '(no subject)'::text) || ' · PO: '::text) || array_to_string(empo.po_numbers, ', '::text)
            ELSE COALESCE(empo.email_subject, '(no subject)'::text)
        END AS context,
    empo.scanned_at AS created_at,
    ov.zendesk_ticket_id,
    ov.zendesk_synced_at,
    ov.usa_team_note,
    ov.vietnam_team_note,
    ov.follow_up_at,
    COALESCE(ov.checked, false) AS checked,
    ov.checked_at
   FROM email_missing_purchase_orders empo
     LEFT JOIN unfound_overlay ov ON ov.source_kind = 'email_po'::text AND ov.source_id = empo.id::text AND ov.organization_id = empo.organization_id
  WHERE empo.pile <> 'done'::text;

-- v_sku: the `origin_sku_id IS NOT NULL` branch is permanently dead (origin_sku_id
-- was never populated; app-side provenance uses text-only SKU_IMPORT edges), and
-- the live branch's `origin_sku_id IS NULL` filter matched every row. Drop the
-- dead branch + the vacuous filter — output is byte-identical (all ids stay the
-- id+1e9 form the sku/by-tracking DELETE already assumes).
CREATE OR REPLACE VIEW v_sku AS
 SELECT su.id + 1000000000 AS id,
    su.created_at AS date_time,
    su.sku AS static_sku,
    su.serial_number,
    su.shipping_tracking_number,
    COALESCE(su.legacy_notes, su.notes) AS notes,
    su.current_location AS location,
    su.created_at,
    su.updated_at,
    su.shipment_id,
    su.id AS serial_unit_id
   FROM serial_units su;

-- Writes must already be app-side; remove the Phase 2 dual-write trigger first.
DROP TRIGGER IF EXISTS trg_sync_serial_unit_provenance ON serial_units;
DROP FUNCTION IF EXISTS fn_sync_serial_unit_provenance();

ALTER TABLE serial_units
  DROP COLUMN IF EXISTS origin_source,
  DROP COLUMN IF EXISTS origin_receiving_line_id,
  DROP COLUMN IF EXISTS origin_tsn_id,
  DROP COLUMN IF EXISTS origin_sku_id;

COMMIT;
