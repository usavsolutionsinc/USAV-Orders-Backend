import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
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

/** Handling-unit (LPN) handle, format `H-123` (case-insensitive). */
const HANDLING_UNIT_RE = /^H-\d+$/i;

/** How a scan was matched — lets the UI tell the operator what it recognised. */
export type ResolvedVia = 'handle' | 'unit_id' | 'serial' | 'receiving_id' | 'po' | 'tracking' | 'lpn' | 'sku';

/**
 * Explicit search type the operator armed via the scan-bar mode buttons. When
 * set, auto-detection is bypassed and ONLY this type is searched — matching the
 * shipping station's "arm a mode, next scan is forced" behaviour.
 *
 * `sku` resolves a scanned product SKU (the printed product label / pre-pack
 * sticker) to its pre-packed receiving line(s) — the row already carries the
 * pre-pack state (sku, condition grade, saved serial_units) the testing panel
 * prefills from. Read-only resolve: it never mints or mutates a serial.
 */
export type ForcedTestingType = 'tracking' | 'po' | 'serial' | 'sku';

export type ResolvedTestingScan =
  | { kind: 'line'; row: ReceivingLineRow; via?: ResolvedVia }
  | { kind: 'multi'; rows: ReceivingLineRow[]; receivingId: number; via?: ResolvedVia }
  /**
   * A license-plated box/tray (H-####) scan. Carries the resolved
   * `handlingUnitId` so a workbench consumer can open the box panel to re-sort
   * its units; `rows` (the box's receiving lines) are kept so consumers that
   * only want the lines — the mobile list, the receiving picker — degrade to
   * the same behaviour as `multi`.
   */
  | {
      kind: 'box';
      handlingUnitId: number;
      rows: ReceivingLineRow[];
      receivingId: number;
      via: 'lpn';
    }
  /**
   * A preboxed KIT master label (KIT-####). Carries the scanned `manifestRef`
   * (the manifest_uid) so a workbench consumer can open the manifest detail
   * panel; the mobile/receiving consumers ignore it (no manifest surface there).
   */
  | { kind: 'manifest'; manifestRef: string }
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

/**
 * Canonical handling-unit (LPN) handle — `H-{id}` (current, from
 * handlingUnitHandle in lib/barcode-routing). Mirrors {@link looksLikeReceivingRef}.
 */
export function looksLikeHandlingUnit(value: string): boolean {
  return HANDLING_UNIT_RE.test(value.trim());
}

/** `L-{id}` line / `U-{id}` unit / `REP-{id}` repair label handles. */
const LINE_UNIT_REPAIR_RE = /^(?:L|U|REP)-\d+$/i;

/**
 * Cheap synchronous test: does this value look like a canonical internal CODE
 * — a carton/line/unit/handling-unit/repair handle, the legacy `RCV-{id}`
 * string, or a printed unit-id ({SKU}-{YYWW}-{SEQ6}) — as opposed to a PO
 * number, an order/reference number, or a carrier tracking number?
 *
 * Used by the receiving scan bar to decide whether to run
 * {@link resolveReceivingCodeToLine} even when the dash auto-classify
 * heuristic ({@link classifyUnboxScan}) armed Order# mode. EVERY canonical
 * handle contains a dash, so without this check `R-123` / `H-7` / a unit-id
 * would be classified as an order and mis-routed to the PO lookup (which
 * finds nothing). True PO/order/tracking values return false here and keep
 * their existing lookup-po routing untouched.
 */
export function looksLikeReceivingCode(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return (
    looksLikeReceivingRef(v) ||      // R-{id} / RCV-{id} carton
    looksLikeHandlingUnit(v) ||      // H-{id} handling unit
    LINE_UNIT_REPAIR_RE.test(v) ||   // L-{id} / U-{id} / REP-{id}
    looksLikeUnitId(v)               // {SKU}-{YYWW}-{SEQ6} printed unit-id
  );
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
  // The route filters by `search` + `searchField`, NOT a bare
  // `zoho_purchaseorder_number` param — `searchField=po` matches the scan
  // against rl.zoho_purchaseorder_id / rl.zoho_purchaseorder_number /
  // r.zoho_purchaseorder_number. `view=all` widens the scope to the full
  // dataset (not just the current week).
  const params = new URLSearchParams({
    limit: '50',
    offset: '0',
    include: 'serials',
    view: 'all',
    search_field: 'po',
    search: poNumber,
  });
  const res = await fetch(`/api/receiving-lines?${params.toString()}`);
  if (!res.ok) throw new Error(`receiving-lines fetch failed (${res.status})`);
  const data = await res.json();
  const all = (data?.receiving_lines ?? []) as ReceivingLineRow[];
  // ILIKE `%po%` can hit superstrings; keep only rows whose PO actually equals
  // the scan (case-insensitive) so "PO-12" can't drag in "PO-1234".
  const want = poNumber.trim().toUpperCase();
  const exact = all.filter((row) => {
    const candidates = [
      row.zoho_purchaseorder_number,
      (row as { receiving_zoho_purchaseorder_number?: string | null }).receiving_zoho_purchaseorder_number,
      row.zoho_purchaseorder_id != null ? String(row.zoho_purchaseorder_id) : null,
    ];
    return candidates.some((c) => String(c ?? '').trim().toUpperCase() === want);
  });
  // Fall back to the ILIKE results if nothing matched exactly (e.g. the scan
  // was a partial PO the operator expects to fuzzy-match).
  return exact.length > 0 ? exact : all;
}

/**
 * Resolve a scanned product SKU to the receiving line(s) that hold it — the
 * pre-pack lookup. Uses the receiving-lines `sku` search (ILIKE on rl.sku /
 * rl.zoho_item_id), then keeps only EXACT SKU matches so "ABC-1" can't drag in
 * "ABC-12". `include=serials` so the returned row carries the pre-packed
 * serial_units (sku + condition grade + saved serials) the testing panel
 * prefills its fields from. Read-only — no serial is minted or mutated.
 */
async function fetchLinesBySku(sku: string): Promise<ReceivingLineRow[]> {
  const params = new URLSearchParams({
    limit: '50',
    offset: '0',
    include: 'serials',
    view: 'all',
    search_field: 'sku',
    search: sku,
  });
  const res = await fetch(`/api/receiving-lines?${params.toString()}`);
  if (!res.ok) throw new Error(`receiving-lines fetch failed (${res.status})`);
  const data = await res.json();
  const all = (data?.receiving_lines ?? []) as ReceivingLineRow[];
  const want = sku.trim().toUpperCase();
  const exact = all.filter((row) => {
    const candidates = [row.sku, (row as { zoho_item_id?: string | null }).zoho_item_id];
    return candidates.some((c) => String(c ?? '').trim().toUpperCase() === want);
  });
  // Keep the ILIKE hits when nothing matched exactly so a partial SKU the
  // operator expects to fuzzy-match still surfaces.
  return exact.length > 0 ? exact : all;
}

/**
 * Find receiving lines whose serial ENDS WITH the scanned value — the
 * "last 4 of the serial / PO" quick lookup. Uses the receiving-lines default
 * search (ILIKE `%value%` across PO#, serial, sku, tracking) once, then splits
 * the hits into true SUFFIX matches on a serial vs. on the PO number/id — so a
 * short code behaves like "ends with", matching the last-4 chips elsewhere.
 *
 * Returns the two buckets separately so the caller can apply the precedence
 * "serial first, then PO".
 */
async function fetchLinesByPartial(
  value: string,
): Promise<{ serialRows: ReceivingLineRow[]; poRows: ReceivingLineRow[] }> {
  const params = new URLSearchParams({
    limit: '25',
    offset: '0',
    include: 'serials',
    view: 'all',
    search: value,
  });
  const res = await fetch(`/api/receiving-lines?${params.toString()}`);
  if (!res.ok) throw new Error(`receiving-lines fetch failed (${res.status})`);
  const data = await res.json();
  const all = (data?.receiving_lines ?? []) as ReceivingLineRow[];
  const want = value.trim().toUpperCase();

  const serialRows = all.filter((row) =>
    (row.serials ?? []).some((s) =>
      String(s.serial_number || '').trim().toUpperCase().endsWith(want),
    ),
  );
  const poRows = all.filter((row) =>
    [
      row.zoho_purchaseorder_number,
      (row as { receiving_zoho_purchaseorder_number?: string | null })
        .receiving_zoho_purchaseorder_number,
      row.zoho_purchaseorder_id != null ? String(row.zoho_purchaseorder_id) : null,
    ]
      .map((v) => String(v ?? '').trim().toUpperCase())
      .some((v) => v.length > 0 && v.endsWith(want)),
  );

  return { serialRows, poRows };
}

/**
 * Resolve a tracking number to the receiving lines already in the LOCAL
 * system (door-scanned cartons, incoming-synced lines). Exported so the
 * receiving sidebar can short-circuit an unbox scan of an in-system carton —
 * open it immediately from this query instead of round-tripping lookup-po
 * (and its Zoho fallback) behind the "Opening your PO" loader.
 */
export async function fetchLinesByTracking(tracking: string) {
  // Small limit is enough to find the carton already in the system and skip
  // lookup-po entirely. `include=serials` is cheap at this limit and lets the
  // testing multi-picker show serial chips on tracking-resolved rows too (the
  // receiving unbox short-circuit ignores the extra field harmlessly).
  const params = new URLSearchParams({
    limit: '5',
    offset: '0',
    view: 'all',
    include: 'serials',
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
  // serial_number for label-minted units). Reads current_receiving_line_id —
  // the unit's CURRENT line (most recent inventory_events touch) — never
  // origin_receiving_line_id, which freezes to the FIRST-ever receiving line
  // and would jump to a stale PO once the unit has been returned and
  // re-received under a different one.
  const res = await fetch(`/api/serial-units/${encodeURIComponent(unitId)}`);
  if (!res.ok) return null;
  const data = await res.json();
  const unit = data?.unit ?? data?.serial_unit ?? data;
  const receivingLineId = unit?.current_receiving_line_id ?? unit?.origin_receiving_line_id;
  if (!receivingLineId) return null;
  return fetchLineById(receivingLineId);
}

/**
 * Resolve a handling-unit (LPN) handle to the receiving lines its member units
 * belong to. One box scan → every line in the box. The detail endpoint returns
 * `receiving_line_ids` (distinct origin_receiving_line_id of the box's units);
 * we hydrate each to a full ReceivingLineRow via the existing single-line fetch
 * so the multi-picker gets exactly the shape it already renders. A box of N
 * units typically spans only a few lines, so the fan-out is small.
 */
async function fetchLinesByHandlingUnit(handlingUnitId: number): Promise<ReceivingLineRow[]> {
  const res = await fetch(`/api/handling-units/${handlingUnitId}`);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`handling-units fetch failed (${res.status})`);
  }
  const data = await res.json();
  const lineIds = (data?.handling_unit?.receiving_line_ids ?? data?.receiving_line_ids ?? []) as number[];
  const ids = lineIds.filter((id): id is number => Number.isFinite(id));
  if (ids.length === 0) return [];
  const rows = await Promise.all(ids.map((id) => fetchLineById(id)));
  return rows.filter((r): r is ReceivingLineRow => r != null);
}

async function fetchLineById(lineId: number): Promise<ReceivingLineRow | null> {
  const res = await fetch(`/api/receiving-lines?id=${lineId}&include=serials`);
  if (!res.ok) return null;
  const data = await res.json();
  return (data?.receiving_line ?? null) as ReceivingLineRow | null;
}

/**
 * Find the receiving line(s) that received a given physical serial number.
 * Uses the receiving-lines `serial` search (which joins serial_units on
 * origin_receiving_line_id) and then filters to an EXACT serial match so a
 * short/partial scan can't drag in unrelated rows. This is the path for
 * "scan the bare serial printed on the unit → jump to its PO".
 */
async function fetchLinesBySerial(serial: string): Promise<ReceivingLineRow[]> {
  const params = new URLSearchParams({
    limit: '10',
    offset: '0',
    include: 'serials',
    view: 'all',
    search_field: 'serial',
    search: serial,
  });
  const res = await fetch(`/api/receiving-lines?${params.toString()}`);
  if (!res.ok) throw new Error(`receiving-lines fetch failed (${res.status})`);
  const data = await res.json();
  const all = (data?.receiving_lines ?? []) as ReceivingLineRow[];
  const want = serial.trim().toUpperCase();
  return all.filter((row) =>
    (row.serials ?? []).some(
      (s) => String(s.serial_number || '').trim().toUpperCase() === want,
    ),
  );
}

/**
 * Resolve a tech-testing scan to one or more receiving lines. Accepted shapes:
 *
 *   • GS1 Digital Link URL (`/01/{gtin}/21/{serial}`) — printed unit QR
 *   • Unit ID string ({SHORTSKU}-{YYWW}-{SEQ6})
 *   • `RCV-{receiving_id}` internal carton ref (unmatched cartons)
 *   • `H-{id}` handling-unit (LPN) handle — fans out to every unit in the box
 *   • PO number (PO-1234)
 *
 * Returns `multi` when a carton has >1 receiving_line so the workspace can
 * mount a picker; `line` when there is exactly one match.
 */
export async function resolveTestingScan(
  raw: string,
  opts?: { forcedType?: ForcedTestingType | null },
): Promise<ResolvedTestingScan> {
  const value = (raw ?? '').trim();
  if (!value) return { kind: 'not_found', query: '' };

  try {
    // Armed mode — the operator picked a specific search type in the scan bar.
    // Skip auto-detection and search only that type (full value or last-4).
    if (opts?.forcedType) {
      return resolveForcedTestingScan(value, opts.forcedType);
    }

    // Codes first — handle / unit-id / raw serial / receiving id. Returns null
    // only when the value isn't a code we recognise, so we can fall through to
    // the PO# and tracking branches below.
    const code = await resolveReceivingCodeToLine(value);
    if (code) return code;

    // PO number (PO-1234).
    if (PO_NUMBER_RE.test(value)) {
      const rows = await fetchLinesByPoNumber(value.toUpperCase());
      if (rows.length === 0) return { kind: 'not_found', query: value };
      if (rows.length === 1) return { kind: 'line', row: rows[0], via: 'po' };
      const receivingId = rows.find((r) => r.receiving_id != null)?.receiving_id ?? 0;
      return { kind: 'multi', rows, receivingId, via: 'po' };
    }

    // Tracking number — `classifyInput` recognises every carrier in
    // TRACKING_PATTERNS. Same regex set the receiving sidebar uses.
    const classified = classifyInput(value);
    if (classified.type === 'tracking') {
      const rows = await fetchLinesByTracking(value);
      if (rows.length === 0) return { kind: 'not_found', query: value };
      if (rows.length === 1) return { kind: 'line', row: rows[0], via: 'tracking' };
      const receivingId = rows.find((r) => r.receiving_id != null)?.receiving_id ?? 0;
      return { kind: 'multi', rows, receivingId, via: 'tracking' };
    }

    // Partial scan — the "last 4" quick lookup. Restricted to short alphanumeric
    // scans (3–24 chars) so it can't swallow long codes. Precedence: serial
    // first, then PO. >1 hit in a bucket → picker so the tech chooses the line.
    if (/^[A-Za-z0-9-]{3,24}$/.test(value)) {
      const { serialRows, poRows } = await fetchLinesByPartial(value);
      // Serial suffix wins.
      if (serialRows.length === 1) return { kind: 'line', row: serialRows[0], via: 'serial' };
      if (serialRows.length > 1) {
        const receivingId = serialRows.find((r) => r.receiving_id != null)?.receiving_id ?? 0;
        return { kind: 'multi', rows: serialRows, receivingId, via: 'serial' };
      }
      // No serial match → fall back to PO suffix.
      if (poRows.length === 1) return { kind: 'line', row: poRows[0], via: 'po' };
      if (poRows.length > 1) {
        const receivingId = poRows.find((r) => r.receiving_id != null)?.receiving_id ?? 0;
        return { kind: 'multi', rows: poRows, receivingId, via: 'po' };
      }
    }

    // Product SKU (printed product / pre-pack label) — the auto-detect tail.
    // Reached only when the value isn't a code / PO / tracking / serial-or-PO
    // suffix above, so a SKU sticker scan resolves to its pre-packed receiving
    // line(s) and the testing panel prefills from that row's pre-pack state.
    if (/^[A-Za-z0-9][A-Za-z0-9._/-]{1,39}$/.test(value)) {
      const skuRows = await fetchLinesBySku(value);
      if (skuRows.length > 0) return linesToResult(skuRows, 'sku', value);
    }

    return { kind: 'not_found', query: value };
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Scan resolution failed',
    };
  }
}

/** Shape a list of matched lines into a line / multi / not_found result. */
function linesToResult(
  rows: ReceivingLineRow[],
  via: ResolvedVia,
  query: string,
): ResolvedTestingScan {
  if (rows.length === 1) return { kind: 'line', row: rows[0], via };
  if (rows.length > 1) {
    const receivingId = rows.find((r) => r.receiving_id != null)?.receiving_id ?? 0;
    return { kind: 'multi', rows, receivingId, via };
  }
  return { kind: 'not_found', query };
}

/**
 * Forced single-type resolution for the scan-bar mode buttons. Searches ONLY
 * the armed type — tracking, PO#, or serial — accepting either the full value
 * or the last-4 (suffix). No auto-detection fallthrough.
 */
async function resolveForcedTestingScan(
  value: string,
  type: ForcedTestingType,
): Promise<ResolvedTestingScan> {
  if (type === 'tracking') {
    return linesToResult(await fetchLinesByTracking(value), 'tracking', value);
  }
  if (type === 'sku') {
    // Pre-pack lookup — resolve the scanned product SKU to its receiving
    // line(s) so the panel prefills from the pre-packed state. Read-only.
    return linesToResult(await fetchLinesBySku(value), 'sku', value);
  }
  // serial + PO share one search; pick the matching bucket (full or last-4).
  const { serialRows, poRows } = await fetchLinesByPartial(value);
  return type === 'serial'
    ? linesToResult(serialRows, 'serial', value)
    : linesToResult(poRows, 'po', value);
}

/**
 * Resolve a scan that is a *code* — a carton/line/unit handle, a printed
 * unit-id, a GS1 unit URL, a bare physical serial number, or a bare receiving
 * (carton) id — to its receiving line. Deliberately excludes tracking numbers
 * and PO numbers: returns `null` for those (and for anything unrecognised) so
 * the receiving sidebar can fall through to its tracking-intake flow instead
 * of mis-routing a carton scan.
 *
 * Shared by the testing sidebar ({@link resolveTestingScan}) and the receiving
 * sidebar so "scan the serial / receiving id → jump to the PO" behaves
 * identically on both pages.
 */
export async function resolveReceivingCodeToLine(
  raw: string,
): Promise<ResolvedTestingScan | null> {
  const value = (raw ?? '').trim();
  if (!value) return null;

  try {
    // 1. Canonical handles via `routeScan` — `R-{id}` carton, `L-{id}` line,
    //    `U-{id}` unit, legacy `RCV-{id}`, and GS1 Digital Link URLs.
    const routed = routeScan(value);
    if (routed) {
      if (routed.type === 'receiving') {
        const id = Number(routed.redirect?.match(/\/m\/r\/(\d+)$/)?.[1]);
        if (Number.isFinite(id)) {
          const rows = await fetchLinesByReceivingId(id);
          if (rows.length === 0) return { kind: 'not_found', query: value };
          if (rows.length === 1) return { kind: 'line', row: rows[0], via: 'handle' };
          return { kind: 'multi', rows, receivingId: id, via: 'handle' };
        }
      }
      if (routed.type === 'receiving-line') {
        const id = Number(routed.redirect?.match(/\/m\/l\/(\d+)$/)?.[1]);
        if (Number.isFinite(id)) {
          const row = await fetchLineById(id);
          return row ? { kind: 'line', row, via: 'handle' } : { kind: 'not_found', query: value };
        }
      }
      if (routed.type === 'serial-unit') {
        const ref = routed.redirect?.match(/\/m\/u\/(.+)$/)?.[1];
        if (ref) {
          const row = await fetchLineByUnitId(decodeURIComponent(ref));
          return row ? { kind: 'line', row, via: 'unit_id' } : { kind: 'not_found', query: value };
        }
      }
      // H-class — a license-plated box/tray. The scan opens the box workbench
      // (desktop drawer) so the operator can re-sort its units across lines; the
      // box's receiving `rows` ride along for consumers that only want the lines
      // (mobile list, receiving picker) and degrade to `multi`-style behaviour.
      if (routed.type === 'handling-unit') {
        const id = Number(routed.redirect?.match(/\/m\/h\/(\d+)$/)?.[1]);
        if (Number.isFinite(id)) {
          const rows = await fetchLinesByHandlingUnit(id);
          if (rows.length === 0) return { kind: 'not_found', query: value };
          const receivingId = rows.find((r) => r.receiving_id != null)?.receiving_id ?? 0;
          return { kind: 'box', handlingUnitId: id, rows, receivingId, via: 'lpn' };
        }
      }
      // KIT-class — a preboxed kit master label. The whole value is the
      // manifest_uid; the workbench opens its detail panel (fetched by uid).
      if (routed.type === 'manifest') {
        return { kind: 'manifest', manifestRef: value };
      }
    }

    // 2. GS1 Digital Link URL (unit) parsed directly for the clean serial.
    const parsedUrl = parseScannedUrl(value);
    if (parsedUrl?.type === 'unit') {
      const row = await fetchLineByUnitId(parsedUrl.unitSerial);
      return row ? { kind: 'line', row, via: 'unit_id' } : { kind: 'not_found', query: parsedUrl.unitSerial };
    }

    // 3. Printed unit id typed directly (no handle prefix).
    if (UNIT_ID_RE.test(value)) {
      const row = await fetchLineByUnitId(value);
      return row ? { kind: 'line', row, via: 'unit_id' } : { kind: 'not_found', query: value };
    }

    // Don't treat a tracking number as a serial — let the caller's tracking
    // flow own it.
    if (classifyInput(value).type === 'tracking') return null;

    // 4. Bare physical serial number printed on the unit → its receiving line.
    const bySerial = await fetchLinesBySerial(value);
    if (bySerial.length === 1) return { kind: 'line', row: bySerial[0], via: 'serial' };
    if (bySerial.length > 1) {
      const receivingId = bySerial.find((r) => r.receiving_id != null)?.receiving_id ?? 0;
      return { kind: 'multi', rows: bySerial, receivingId, via: 'serial' };
    }

    // A bare number is NOT treated as a carton id — cartons are only ever
    // referenced by their `R-{id}` handle (resolved by routeScan above). Bare
    // short codes fall through to the serial-then-PO partial match instead, so
    // "last 4 of the PO" (e.g. 7001) isn't shadowed by a carton-id guess.
    return null;
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Scan resolution failed',
    };
  }
}
