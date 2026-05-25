import pool from '@/lib/db';

export type ClaimType =
  | 'damage'
  | 'missing'
  | 'wrong_item'
  | 'vendor_defect'
  | 'unfound'
  | 'repair_service';
export type ClaimSeverity = 'low' | 'medium' | 'high';

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  damage: 'Damage',
  missing: 'Missing item',
  wrong_item: 'Wrong item',
  vendor_defect: 'Vendor defect',
  unfound: 'Unfound — no PO match',
  repair_service: 'Repair service',
};

export const CLAIM_SEVERITY_LABEL: Record<ClaimSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export interface ClaimTemplateInput {
  receivingId: number;
  lineId?: number | null;
  claimType: ClaimType;
  severity: ClaimSeverity;
  reason?: string;
}

export interface ClaimTemplateResult {
  subject: string;
  description: string;
}

export async function buildReceivingClaimTemplate(
  input: ClaimTemplateInput,
): Promise<ClaimTemplateResult> {
  const { receivingId, lineId, claimType, severity, reason } = input;

  const recvResult = await pool.query(
    `SELECT r.id,
            r.source_platform,
            s.tracking_number_raw AS tracking_number,
            COALESCE(rl.zoho_purchaseorder_number, r.zoho_purchaseorder_number) AS zoho_purchaseorder_number,
            COALESCE(rl.zoho_purchaseorder_id, r.zoho_purchaseorder_id) AS zoho_purchaseorder_id
     FROM receiving r
     LEFT JOIN shipping_tracking_numbers s ON s.id = r.shipment_id
     LEFT JOIN receiving_lines rl
            ON rl.receiving_id = r.id
           AND ($2::int IS NULL OR rl.id = $2)
     WHERE r.id = $1
     ORDER BY rl.id NULLS LAST
     LIMIT 1`,
    [receivingId, lineId ?? null],
  );
  const carton = recvResult.rows[0] as
    | {
        id: number;
        source_platform: string | null;
        tracking_number: string | null;
        zoho_purchaseorder_number: string | null;
        zoho_purchaseorder_id: string | null;
      }
    | undefined;
  if (!carton) throw new Error('Receiving not found');

  let lineSummary = '';
  if (lineId) {
    const lineResult = await pool.query(
      `SELECT item_name, sku, quantity_received, quantity_expected, condition_grade
       FROM receiving_lines WHERE id = $1 LIMIT 1`,
      [lineId],
    );
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
      const qty = line.quantity_expected != null
        ? `${line.quantity_received}/${line.quantity_expected}`
        : `${line.quantity_received}`;
      lineSummary = `Item: ${title} · qty ${qty} · condition ${line.condition_grade || 'PENDING'}`;
    }
  }

  const photoResult = await pool.query(
    `SELECT url FROM photos
     WHERE entity_type = 'RECEIVING' AND entity_id = $1
     ORDER BY created_at ASC`,
    [receivingId],
  );
  const photoUrls = (photoResult.rows as Array<{ url: string | null }>)
    .map((p) => String(p.url || ''))
    .filter((u) => !!u.trim());

  // Unfound flow: collapse subject + body to a single short token ("Unfound
  // PO") and stop pretending the receiving_id IS a PO# — operators were
  // getting confused by "PO #4232" where 4232 was just the internal row id.
  const hasPo = !!(carton.zoho_purchaseorder_number || carton.zoho_purchaseorder_id);
  const poRef = hasPo
    ? (carton.zoho_purchaseorder_number || carton.zoho_purchaseorder_id) as string
    : 'Unfound PO';
  const trackingRef = carton.tracking_number || 'n/a';
  // Dropped the 'USAV' fallback — the platform tag only leads the subject
  // when an actual marketplace platform is set.
  const platformTag = (carton.source_platform || '').trim().toUpperCase();
  const subjectPrefix = platformTag ? `${platformTag} ` : '';

  const subject = hasPo
    ? `${subjectPrefix}Receiving Claim — ${CLAIM_TYPE_LABEL[claimType]} — PO ${poRef}`
    : `${subjectPrefix}Receiving Claim — ${poRef}`;

  const trimmedReason = String(reason ?? '').trim();
  const descriptionLines: string[] = [
    `Type: ${CLAIM_TYPE_LABEL[claimType]}`,
    `Severity: ${CLAIM_SEVERITY_LABEL[severity]}`,
    `PO: ${poRef}`,
    `Tracking: ${trackingRef}`,
    lineSummary ? lineSummary : `Package-wide claim (no specific line)`,
    '',
  ];
  if (trimmedReason) {
    descriptionLines.push('Receiving Notes:', trimmedReason, '');
  }
  if (photoUrls.length > 0) {
    descriptionLines.push(`Photos attached (${photoUrls.length}):`);
    photoUrls.forEach((url) => descriptionLines.push(`- ${url}`));
  } else {
    descriptionLines.push('Photos: (none uploaded yet)');
  }

  return { subject, description: descriptionLines.join('\n') };
}
