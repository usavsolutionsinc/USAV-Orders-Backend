import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { classifyInput, parseScannedUrl } from '@/lib/scan-resolver';
import { routeScan } from '@/lib/barcode-routing';

/**
 * Unit-id format printed by MultiSkuSnBarcode / unit-id.ts:
 *   {SHORTSKU}-{YYWW}-{SEQ6}      e.g. 00098-2621-000142
 * SHORTSKU = uppercase alphanumeric (dashes allowed), trimmed to ≤20 chars.
 *
 * NOTE: anchored at the END to avoid eating canonical R-/L-/U-/REP- handles
 * which superficially look like "{LETTER}-{digits}-{digits}". `routeScan`
 * runs first now, so this regex is the final unit-id fallback only.
 */
const UNIT_ID_RE = /^[A-Z0-9](?:[A-Z0-9-]{0,19})-\d{4}-\d{6}$/i;

/** Zoho PO number, format `PO-1234` (case-insensitive). */
const PO_NUMBER_RE = /^PO-?\d+$/i;

export type ResolvedTestingScan =
  | { kind: 'line'; row: ReceivingLineRow }
  | { kind: 'multi'; rows: ReceivingLineRow[]; receivingId: number }
  | { kind: 'not_found'; query: string }
  | { kind: 'error'; message: string };

export function looksLikeUnitId(value: string): boolean {
  return UNIT_ID_RE.test(value.trim());
}

export function looksLikeReceivingRef(value: string): boolean {
  // Canonical carton handles: `R-{id}` (current, from receivingHandle in
  // lib/barcode-routing) and `RCV-{id}` (legacy pre-DataMatrix labels).
  const v = value.trim();
  return /^(R|RCV)-\d+$/i.test(v);
}

export function looksLikePoNumber(value: string): boolean {
  return PO_NUMBER_RE.test(value.trim());
}

async function fetchLinesByReceivingId(receivingId: number) {
  const res = await fetch(
    `/api/receiving-lines?receiving_id=${receivingId}&include=serials`,
  );
  if (!res.ok) throw new Error(`receiving-lines fetch failed (${res.status})`);
  const data = await res.json();
  return (data?.receiving_lines ?? []) as ReceivingLineRow[];
}

async function fetchLinesByPoNumber(poNumber: string) {
  const params = new URLSearchParams({
    limit: '50',
    offset: '0',
    include: 'serials',
    zoho_purchaseorder_number: poNumber,
  });
  const res = await fetch(`/api/receiving-lines?${params.toString()}`);
  if (!res.ok) throw new Error(`receiving-lines fetch failed (${res.status})`);
  const data = await res.json();
  return (data?.receiving_lines ?? []) as ReceivingLineRow[];
}

async function fetchLinesByTracking(tracking: string) {
  // `view=all` + `search` matches against tracking, PO#, serial, sku — the
  // same dataset the receiving History table uses. Limit small so a typoed
  // partial doesn't return hundreds of unrelated rows.
  const params = new URLSearchParams({
    limit: '10',
    offset: '0',
    include: 'serials',
    view: 'all',
    search: tracking,
  });
  const res = await fetch(`/api/receiving-lines?${params.toString()}`);
  if (!res.ok) throw new Error(`receiving-lines fetch failed (${res.status})`);
  const data = await res.json();
  const all = (data?.receiving_lines ?? []) as ReceivingLineRow[];
  // Narrow to rows whose tracking_number actually matches (ILIKE search may
  // hit other columns). Compare canonicalized form so dashes/spaces in the
  // scan don't keep us from finding a row stored without them.
  const canon = (v: string) => v.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const want = canon(tracking);
  return all.filter((row) => canon(String(row.tracking_number || '')) === want);
}

async function fetchLineByUnitId(unitId: string): Promise<ReceivingLineRow | null> {
  // /api/serial-units/[id] accepts either the numeric id or a serial_number
  // string (the unit-id printed under the DataMatrix is stored as the
  // serial_number for label-minted units). Returns origin_receiving_line_id
  // which is the back-reference to the receiving scan that minted this unit.
  const res = await fetch(`/api/serial-units/${encodeURIComponent(unitId)}`);
  if (!res.ok) return null;
  const data = await res.json();
  const unit = data?.unit ?? data?.serial_unit ?? data;
  const receivingLineId = unit?.origin_receiving_line_id;
  if (!receivingLineId) return null;
  return fetchLineById(receivingLineId);
}

async function fetchLineById(lineId: number): Promise<ReceivingLineRow | null> {
  const res = await fetch(`/api/receiving-lines?id=${lineId}&include=serials`);
  if (!res.ok) return null;
  const data = await res.json();
  return (data?.receiving_line ?? null) as ReceivingLineRow | null;
}

/**
 * Resolve a tech-testing scan to one or more receiving lines. Accepted shapes:
 *
 *   • GS1 Digital Link URL (`/01/{gtin}/21/{serial}`) — printed unit QR
 *   • Unit ID string ({SHORTSKU}-{YYWW}-{SEQ6})
 *   • `RCV-{receiving_id}` internal carton ref (unmatched cartons)
 *   • PO number (PO-1234)
 *
 * Returns `multi` when a carton has >1 receiving_line so the workspace can
 * mount a picker; `line` when there is exactly one match.
 */
export async function resolveTestingScan(raw: string): Promise<ResolvedTestingScan> {
  const value = (raw ?? '').trim();
  if (!value) return { kind: 'not_found', query: '' };

  try {
    // 1. Canonical handle parsing via `routeScan` — same parser used app-wide
    //    for receiving (`R-{id}`), receiving-line (`L-{id}`), serial-unit
    //    (`U-{id}`), legacy `RCV-{id}`, and GS1 Digital Link URLs. Anything
    //    `routeScan` knows about wins over the loose regexes below.
    const routed = routeScan(value);
    if (routed) {
      if (routed.type === 'receiving') {
        // `R-{id}` or legacy `RCV-{id}` — redirect path is /m/r/{id}.
        const idMatch = routed.redirect?.match(/\/m\/r\/(\d+)$/);
        const id = idMatch ? Number(idMatch[1]) : NaN;
        if (Number.isFinite(id)) {
          const rows = await fetchLinesByReceivingId(id);
          if (rows.length === 0) return { kind: 'not_found', query: value };
          if (rows.length === 1) return { kind: 'line', row: rows[0] };
          return { kind: 'multi', rows, receivingId: id };
        }
      }
      if (routed.type === 'receiving-line') {
        // `L-{id}` — direct lookup by receiving_lines.id.
        const idMatch = routed.redirect?.match(/\/m\/l\/(\d+)$/);
        const id = idMatch ? Number(idMatch[1]) : NaN;
        if (Number.isFinite(id)) {
          const row = await fetchLineById(id);
          if (row) return { kind: 'line', row };
          return { kind: 'not_found', query: value };
        }
      }
      if (routed.type === 'serial-unit') {
        // `U-{id}` or GS1 `/01/{gtin}/21/{serial}` → originating line.
        const idMatch = routed.redirect?.match(/\/m\/u\/(.+)$/);
        const ref = idMatch ? decodeURIComponent(idMatch[1]) : '';
        if (ref) {
          const row = await fetchLineByUnitId(ref);
          if (row) return { kind: 'line', row };
          return { kind: 'not_found', query: ref };
        }
      }
    }

    // 2. GS1 Digital Link URL parsed by `parseScannedUrl` — kept as a
    //    direct path for clarity (routeScan also handles this above but
    //    falling through to scan-resolver gives us the unit-serial cleanly).
    const parsedUrl = parseScannedUrl(value);
    if (parsedUrl?.type === 'unit') {
      const row = await fetchLineByUnitId(parsedUrl.unitSerial);
      if (row) return { kind: 'line', row };
      return { kind: 'not_found', query: parsedUrl.unitSerial };
    }

    // 3. Unit ID typed directly (no handle prefix).
    if (UNIT_ID_RE.test(value)) {
      const row = await fetchLineByUnitId(value);
      if (row) return { kind: 'line', row };
      return { kind: 'not_found', query: value };
    }

    // 4. PO number
    if (PO_NUMBER_RE.test(value)) {
      const rows = await fetchLinesByPoNumber(value.toUpperCase());
      if (rows.length === 0) return { kind: 'not_found', query: value };
      if (rows.length === 1) return { kind: 'line', row: rows[0] };
      const receivingId = rows.find((r) => r.receiving_id != null)?.receiving_id ?? 0;
      return { kind: 'multi', rows, receivingId };
    }

    // 5. Tracking number — `classifyInput` recognises every carrier in
    //    TRACKING_PATTERNS. Same regex set the receiving sidebar uses, so
    //    parity is automatic when carriers are added there.
    const classified = classifyInput(value);
    if (classified.type === 'tracking') {
      const rows = await fetchLinesByTracking(value);
      if (rows.length === 0) return { kind: 'not_found', query: value };
      if (rows.length === 1) return { kind: 'line', row: rows[0] };
      const receivingId = rows.find((r) => r.receiving_id != null)?.receiving_id ?? 0;
      return { kind: 'multi', rows, receivingId };
    }

    return { kind: 'not_found', query: value };
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Scan resolution failed',
    };
  }
}
