-- ============================================================================
-- 2026-06-06: fn_peek_unit_seq — non-committing preview of the next unit seq
-- ============================================================================
-- fn_next_unit_seq (2026-05-17) atomically allocates AND advances the per-(sku,
-- year) counter. The label printer needs to PREVIEW the next unit id before the
-- operator commits to printing, without burning a sequence number on every SKU
-- search. This read-only sibling returns the value the NEXT allocation will
-- issue: the current next_seq when the row exists, else 1 (fn_next_unit_seq
-- inserts next_seq=2 and returns 1 on the first call, so an absent row → 1).
--
-- Authoritative minting still happens server-side in /api/post-multi-sn via
-- fn_next_unit_seq (one per serial). This function is preview-only.
-- See docs/serial-unit-uid-plan.md (Phase 1, Step 6).
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_peek_unit_seq(p_sku_catalog_id INT, p_year INT)
RETURNS INTEGER LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT next_seq
       FROM unit_id_sequences
      WHERE sku_catalog_id = p_sku_catalog_id
        AND year = p_year),
    1
  );
$$;

COMMENT ON FUNCTION fn_peek_unit_seq(INT, INT) IS
  'Read-only preview of the next unit seq for (sku_catalog_id, year). Does NOT '
  'advance the counter. Authoritative allocation is fn_next_unit_seq.';
