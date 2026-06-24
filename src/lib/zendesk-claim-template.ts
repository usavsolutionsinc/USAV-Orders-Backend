import pool from '@/lib/db';
import { conditionLabel } from '@/components/receiving/zoho-po-types';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { sourcePlatformLabel } from '@/lib/source-platform';
import { receivingLabelTypeDisplay } from '@/lib/print/printReceivingLabel';

export type ClaimType =
  | 'damage'
  | 'missing'
  | 'wrong_item'
  | 'vendor_defect'
  | 'return'
  | 'unfound'
  | 'repair_service';
export type ClaimSeverity = 'low' | 'medium' | 'high';

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  damage: 'Damage',
  missing: 'Missing item',
  wrong_item: 'Wrong item',
  vendor_defect: 'Vendor defect',
  return: 'Return',
  unfound: 'Unfound — no PO match',
  repair_service: 'Repair service',
};

export const CLAIM_SEVERITY_LABEL: Record<ClaimSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/** Render an unboxing timestamp in the shop's local time for the ticket body. */
function formatUnboxedAt(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export interface ClaimTemplateInput {
  receivingId: number;
  lineId?: number | null;
  claimType: ClaimType;
  reason?: string;
  /** "View the PO receiving" link to embed in the body (built from req origin). */
  poReceivingLink?: string;
}

export interface ClaimTemplateResult {
  subject: string;
  description: string;
  /** Real PO# when present (in the title), else null. Drives ticket filenames. */
  poNumber: string | null;
  /** Raw tracking number for the carton, or null. */
  tracking: string | null;
}

export async function buildReceivingClaimTemplate(
  input: ClaimTemplateInput,
  orgId?: OrgId,
): Promise<ClaimTemplateResult> {
  const { receivingId, lineId, claimType, reason, poReceivingLink } = input;

  // When orgId is present, scope the read to the tenant: filter the
  // org-bearing `receiving` row and align the org-bearing `receiving_lines`
  // join on organization_id. `shipping_tracking_numbers` has no
  // organization_id column (NEEDS-COL) — it stays scoped via the integer
  // surrogate-PK join `s.id = r.shipment_id` off the tenant-filtered carton.
  // When omitted, behavior is byte-identical to the original raw-pool path.
  const recvSql = orgId
    ? `SELECT r.id,
            r.source_platform,
            r.intake_type,
            r.unboxed_at,
            su.name AS unboxed_by_name,
            s.tracking_number_raw AS tracking_number,
            COALESCE(rl.zoho_purchaseorder_number, r.zoho_purchaseorder_number) AS zoho_purchaseorder_number,
            COALESCE(rl.zoho_purchaseorder_id, r.zoho_purchaseorder_id) AS zoho_purchaseorder_id,
            rl.receiving_type
     FROM receiving r
     LEFT JOIN shipping_tracking_numbers s ON s.id = r.shipment_id
     LEFT JOIN staff su ON su.id = r.unboxed_by AND su.organization_id = r.organization_id
     LEFT JOIN receiving_lines rl
            ON rl.receiving_id = r.id
           AND rl.organization_id = r.organization_id
           AND ($2::int IS NULL OR rl.id = $2)
     WHERE r.id = $1
       AND r.organization_id = $3
     ORDER BY rl.id NULLS LAST
     LIMIT 1`
    : `SELECT r.id,
            r.source_platform,
            r.intake_type,
            r.unboxed_at,
            su.name AS unboxed_by_name,
            s.tracking_number_raw AS tracking_number,
            COALESCE(rl.zoho_purchaseorder_number, r.zoho_purchaseorder_number) AS zoho_purchaseorder_number,
            COALESCE(rl.zoho_purchaseorder_id, r.zoho_purchaseorder_id) AS zoho_purchaseorder_id,
            rl.receiving_type
     FROM receiving r
     LEFT JOIN shipping_tracking_numbers s ON s.id = r.shipment_id
     LEFT JOIN staff su ON su.id = r.unboxed_by
     LEFT JOIN receiving_lines rl
            ON rl.receiving_id = r.id
           AND ($2::int IS NULL OR rl.id = $2)
     WHERE r.id = $1
     ORDER BY rl.id NULLS LAST
     LIMIT 1`;
  const recvResult = orgId
    ? await tenantQuery(orgId, recvSql, [receivingId, lineId ?? null, orgId])
    : await pool.query(recvSql, [receivingId, lineId ?? null]);
  const carton = recvResult.rows[0] as
    | {
        id: number;
        source_platform: string | null;
        intake_type: string | null;
        unboxed_at: string | Date | null;
        unboxed_by_name: string | null;
        tracking_number: string | null;
        zoho_purchaseorder_number: string | null;
        zoho_purchaseorder_id: string | null;
        receiving_type: string | null;
      }
    | undefined;
  if (!carton) throw new Error('Receiving not found');

  // Serials scanned against the carton/line during unboxing. serial_units is the
  // master the receiving pipeline writes to. Best-effort — a serial-read hiccup
  // must never block filing a claim. Scope to the line when one is given.
  let serials: string[] = [];
  try {
    // Receiving serials live in two stores, both keyed to the line: serial_units
    // (origin_receiving_line_id — NOTE: this table has NO receiving_line_id
    // column; that linkage is origin_receiving_line_id only) and
    // tech_serial_numbers (station_source='RECEIVING', receiving_line_id). We
    // UNION both so a serial shows even if one store lags the other. A CTE
    // resolves the carton's lines once for both halves.
    const serialSql = orgId
      ? `WITH lines AS (
           SELECT id FROM receiving_lines WHERE receiving_id = $1 AND organization_id = $3
         )
         SELECT DISTINCT serial_number FROM (
           SELECT BTRIM(tsn.serial_number) AS serial_number
             FROM tech_serial_numbers tsn
            WHERE tsn.station_source = 'RECEIVING'
              AND tsn.organization_id = $3
              AND tsn.receiving_line_id IN (SELECT id FROM lines)
              AND ($2::int IS NULL OR tsn.receiving_line_id = $2)
           UNION
           SELECT BTRIM(su.serial_number) AS serial_number
             FROM serial_units su
            WHERE su.organization_id = $3
              AND su.origin_receiving_line_id IN (SELECT id FROM lines)
              AND ($2::int IS NULL OR su.origin_receiving_line_id = $2)
         ) s
         WHERE BTRIM(COALESCE(serial_number, '')) <> ''
         ORDER BY serial_number
         LIMIT 50`
      : `WITH lines AS (
           SELECT id FROM receiving_lines WHERE receiving_id = $1
         )
         SELECT DISTINCT serial_number FROM (
           SELECT BTRIM(tsn.serial_number) AS serial_number
             FROM tech_serial_numbers tsn
            WHERE tsn.station_source = 'RECEIVING'
              AND tsn.receiving_line_id IN (SELECT id FROM lines)
              AND ($2::int IS NULL OR tsn.receiving_line_id = $2)
           UNION
           SELECT BTRIM(su.serial_number) AS serial_number
             FROM serial_units su
            WHERE su.origin_receiving_line_id IN (SELECT id FROM lines)
              AND ($2::int IS NULL OR su.origin_receiving_line_id = $2)
         ) s
         WHERE BTRIM(COALESCE(serial_number, '')) <> ''
         ORDER BY serial_number
         LIMIT 50`;
    const serialRes = orgId
      ? await tenantQuery(orgId, serialSql, [receivingId, lineId ?? null, orgId])
      : await pool.query(serialSql, [receivingId, lineId ?? null]);
    serials = serialRes.rows
      .map((r: { serial_number: string | null }) => String(r.serial_number ?? '').trim())
      .filter(Boolean);
  } catch (err) {
    console.warn('[zendesk-claim-template] serial lookup failed', err);
  }

  let lineSummary = '';
  if (lineId) {
    const lineSql = orgId
      ? `SELECT item_name, sku, quantity_received, quantity_expected, condition_grade
       FROM receiving_lines WHERE id = $1 AND organization_id = $2 LIMIT 1`
      : `SELECT item_name, sku, quantity_received, quantity_expected, condition_grade
       FROM receiving_lines WHERE id = $1 LIMIT 1`;
    const lineResult = orgId
      ? await tenantQuery(orgId, lineSql, [lineId, orgId])
      : await pool.query(lineSql, [lineId]);
    const line = lineResult.rows[0] as
      | {
          item_name: string | null;
          sku: string | null;
          quantity_received: number;
          quantity_expected: number | null;
          condition_grade: string | null;
        }
      | undefined;
    if (line) {
      const title = line.item_name || line.sku || `Line #${lineId}`;
      const qtyText = line.quantity_expected != null
        ? `received ${line.quantity_received} of ${line.quantity_expected}`
        : `received ${line.quantity_received}`;
      const condText = line.condition_grade
        ? conditionLabel(line.condition_grade)
        : 'not yet graded';
      lineSummary = `Item: ${title} — ${condText}, ${qtyText}`;
    }
  }

  // Unfound flow: collapse subject + body to a single short token ("Unfound
  // PO") and stop pretending the receiving_id IS a PO# — operators were
  // getting confused by "PO #4232" where 4232 was just the internal row id.
  const hasPo = !!(carton.zoho_purchaseorder_number || carton.zoho_purchaseorder_id);
  const poRef = hasPo
    ? (carton.zoho_purchaseorder_number || carton.zoho_purchaseorder_id) as string
    : 'Unfound PO';
  const trackingRef = carton.tracking_number || 'n/a';
  const effectiveReceivingType = (carton.receiving_type || carton.intake_type || 'PO').trim().toUpperCase();
  const platformLabel = sourcePlatformLabel(carton.source_platform);
  const typeLabel = receivingLabelTypeDisplay(effectiveReceivingType);
  const subjectPlatform =
    platformLabel && platformLabel !== 'Unknown'
      ? (typeLabel ? `${platformLabel} - ${typeLabel}` : platformLabel)
      : typeLabel || 'Unknown';
  // Include the PO# in the title when one is present (it's the operator's
  // primary handle); omit it for unfound cartons where there is no real PO.
  const poSegment = hasPo ? ` // PO ${poRef}` : '';
  const subject = `Claim // ${subjectPlatform} // ${CLAIM_TYPE_LABEL[claimType]}${poSegment} // TRK#${trackingRef}`;

  const unboxedByName = String(carton.unboxed_by_name ?? '').trim();
  const unboxedAtText = formatUnboxedAt(carton.unboxed_at);

  const trimmedReason = String(reason ?? '').trim();
  // Tracking AND the PO# are omitted from the body when they're already in the
  // subject (TRK#… and // PO …). For unfound cartons (no PO in the title) we
  // still note the missing PO so the agent sees it.
  const descriptionLines: string[] = [
    `Issue: ${CLAIM_TYPE_LABEL[claimType]}`,
    ...(hasPo ? [] : [`Purchase Order: ${poRef}`]),
    lineSummary ? lineSummary : `Scope: package-wide (no specific item)`,
  ];
  if (serials.length) {
    descriptionLines.push(`Serial${serials.length > 1 ? 's' : ''}: ${serials.join(', ')}`);
  }
  if (unboxedByName && unboxedAtText) {
    descriptionLines.push(`Unboxed by: ${unboxedByName} · ${unboxedAtText}`);
  } else if (unboxedByName) {
    descriptionLines.push(`Unboxed by: ${unboxedByName}`);
  } else if (unboxedAtText) {
    descriptionLines.push(`Unboxed: ${unboxedAtText}`);
  }
  descriptionLines.push('');
  // Photos ride along as real Zendesk attachments (uploaded at submit from the
  // operator's selection) — no boilerplate line about them in the body. A link
  // back to the carton's receiving workspace gives the agent full context.
  if (poReceivingLink) {
    descriptionLines.push(`View the receiving record: ${poReceivingLink}`);
  }
  if (trimmedReason) {
    descriptionLines.push('', 'Claim reason:', trimmedReason, '');
  }

  return {
    subject,
    description: descriptionLines.join('\n'),
    poNumber: hasPo ? poRef : null,
    tracking: carton.tracking_number || null,
  };
}

/**
 * Render a plaintext claim/ticket body as Zendesk-safe HTML for `comment.html_body`:
 * HTML-escapes the text, turns http(s) URLs into clickable links (so attached
 * photo URLs are one click for agents), bolds "Label:" prefixes, and converts
 * newlines to <br>. Works on both the generated template and operator-edited text.
 */
export function claimBodyToHtml(text: string): string {
  const escape = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const urlRe = /(https?:\/\/[^\s<]+)/g;

  const lines = String(text ?? '').split('\n').map((line) => {
    // Linkify URLs first (against the escaped line), then bold a leading "Label:".
    let html = escape(line).replace(
      urlRe,
      (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
    );
    html = html.replace(/^([A-Za-z][\w /-]{0,40}:)(\s)/, '<strong>$1</strong>$2');
    return html;
  });

  return lines.join('<br>');
}
