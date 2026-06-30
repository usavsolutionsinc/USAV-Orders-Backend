/**
 * Internal-handle resolver — canonical carton/line/unit/handling-unit/repair
 * handles (R-/RCV-/H-/L-/U-/REP-) and printed unit-ids always resolve to their
 * PO line, bypassing carrier-tracking intake. This is what lets a printed
 * `R-{id}` receiving label scan back to its own carton via the IDENTICAL path as
 * any other scan.
 *
 * Every handle contains a dash, so the UI auto-arms Order# mode for them; we
 * therefore still run the resolver in Order# mode WHEN the value looks like a
 * code (`looksLikeCode`) — a true PO/order number returns false there and keeps
 * its lookup-po routing. Tracking numbers and anything unrecognised resolve to
 * `null` (the caller falls through to the next rung untouched).
 *
 * Pure + dependency-injected: `resolveCode` (the I/O) is injected, so the rung
 * runs DB/React-free in unit tests. The hook owns every side-effect.
 */

import type { InternalCodeDeps, InternalCodeResolution, ScanInput } from '../types';

export async function resolveInternalCode(
  input: ScanInput,
  deps: InternalCodeDeps,
): Promise<InternalCodeResolution | null> {
  const runCodeResolve = input.mode !== 'order' || deps.looksLikeCode(input.value);
  if (!runCodeResolve) return null;

  const code = await deps.resolveCode(input.value);
  if (!code || (code.kind !== 'line' && code.kind !== 'multi')) return null;

  const rows = code.kind === 'line' ? [code.row] : code.rows;

  // The line to open: a single line opens itself; a multi prefers its lone OPEN
  // line, else the first open, else the first row.
  const openRows = rows.filter(
    (r) => r.quantity_expected == null || r.quantity_received < (r.quantity_expected ?? 0),
  );
  const pick =
    code.kind === 'line'
      ? code.row
      : openRows.length === 1
        ? openRows[0]
        : openRows[0] ?? rows[0] ?? null;

  // po_ids / receiving_id derived from the resolved rows the same way the
  // local-tracking rung does — for the caller's `onResult` echo.
  const receivingId = rows.find((r) => r.receiving_id != null)?.receiving_id ?? undefined;
  const poIds = [
    ...new Set(
      rows.map((r) => (r.zoho_purchaseorder_id || '').trim()).filter((x) => x.length > 0),
    ),
  ];

  return { kind: 'internal-code', rows, pick, via: code.via ?? null, receivingId, poIds };
}
