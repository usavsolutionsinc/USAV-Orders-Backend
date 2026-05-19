import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';

type ClaimType = 'damage' | 'missing' | 'wrong_item' | 'vendor_defect';
type ClaimSeverity = 'low' | 'medium' | 'high';

const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  damage: 'Damage',
  missing: 'Missing item',
  wrong_item: 'Wrong item',
  vendor_defect: 'Vendor defect',
};

const SEVERITY_LABEL: Record<ClaimSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

interface ClaimRequest {
  receivingId: number;
  lineId?: number | null;
  claimType: ClaimType;
  severity: ClaimSeverity;
  reason?: string;
}

/**
 * Create a Zendesk ticket for a receiving claim (damage / missing / wrong
 * item / vendor defect). Uses the existing GAS Web App bridge (same one
 * powering `createZendeskTicket` in src/lib/zendesk.ts) so we share the
 * same email-relay infrastructure as the repair flow.
 *
 * Photo URLs are inlined into the description body as links (the GAS
 * bridge does not currently parse attachments; a future iteration can
 * extend it to inline images via MIME).
 *
 * On success, returns the ticket number which the client uses to auto-fill
 * the existing `zendesk_ticket` field on the receiving line.
 */
export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = (await req.json().catch(() => null)) as ClaimRequest | null;
    if (!body) throw ApiError.badRequest('Missing body');

    const receivingId = Number(body.receivingId);
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      throw ApiError.badRequest('Valid receivingId is required');
    }

    const claimType = body.claimType;
    if (!claimType || !(claimType in CLAIM_TYPE_LABEL)) {
      throw ApiError.badRequest('Invalid claimType');
    }
    const severity = body.severity ?? 'medium';
    if (!(severity in SEVERITY_LABEL)) {
      throw ApiError.badRequest('Invalid severity');
    }
    const lineId = body.lineId != null ? Number(body.lineId) : null;
    const reason = String(body.reason ?? '').trim();

    // Load carton + (optional) line for ticket context.
    const recvResult = await pool.query(
      `SELECT r.id,
              COALESCE(s.tracking_number, r.tracking_number) AS tracking_number,
              po.zoho_purchaseorder_number,
              po.zoho_purchaseorder_id
       FROM receiving r
       LEFT JOIN shipping_tracking_numbers s ON s.id = r.shipment_id
       LEFT JOIN receiving_lines rl ON rl.receiving_id = r.id
       LEFT JOIN purchase_orders po ON po.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
       WHERE r.id = $1
       LIMIT 1`,
      [receivingId],
    );
    const carton = recvResult.rows[0] as {
      id: number;
      tracking_number: string | null;
      zoho_purchaseorder_number: string | null;
      zoho_purchaseorder_id: string | null;
    } | undefined;
    if (!carton) throw ApiError.notFound('Receiving not found');

    let lineSummary = '';
    if (lineId) {
      const lineResult = await pool.query(
        `SELECT item_name, sku, quantity_received, quantity_expected, condition_grade
         FROM receiving_lines WHERE id = $1 LIMIT 1`,
        [lineId],
      );
      const line = lineResult.rows[0] as {
        item_name: string | null;
        sku: string | null;
        quantity_received: number;
        quantity_expected: number | null;
        condition_grade: string | null;
      } | undefined;
      if (line) {
        const title = line.item_name || line.sku || `Line #${lineId}`;
        const qty = line.quantity_expected != null
          ? `${line.quantity_received}/${line.quantity_expected}`
          : `${line.quantity_received}`;
        lineSummary = `Item: ${title} · qty ${qty} · condition ${line.condition_grade || 'PENDING'}`;
      }
    }

    // Photo URLs — included in the body as links (no attachment yet).
    const photoResult = await pool.query(
      `SELECT url FROM photos
       WHERE entity_type = 'RECEIVING' AND entity_id = $1
       ORDER BY created_at ASC`,
      [receivingId],
    );
    const photoUrls = (photoResult.rows as Array<{ url: string | null }>)
      .map((p) => String(p.url || ''))
      .filter((u) => !!u.trim());

    const poRef = carton.zoho_purchaseorder_number || carton.zoho_purchaseorder_id || `#${receivingId}`;
    const trackingRef = carton.tracking_number || 'n/a';

    const subject = `Receiving Claim — ${CLAIM_TYPE_LABEL[claimType]} — PO ${poRef}`;
    const descriptionLines: string[] = [
      `Type: ${CLAIM_TYPE_LABEL[claimType]}`,
      `Severity: ${SEVERITY_LABEL[severity]}`,
      `PO: ${poRef}`,
      `Tracking: ${trackingRef}`,
      lineSummary ? lineSummary : `Carton-wide claim (no specific line)`,
      '',
    ];
    if (reason) {
      descriptionLines.push('Operator notes:', reason, '');
    }
    if (photoUrls.length > 0) {
      descriptionLines.push(`Photos attached (${photoUrls.length}):`);
      photoUrls.forEach((url) => descriptionLines.push(`- ${url}`));
    } else {
      descriptionLines.push('Photos: (none uploaded yet)');
    }

    const description = descriptionLines.join('\n');

    // Submit to the GAS bridge (same Web App used by createZendeskTicket).
    const gasUrl = process.env.ZendeskTicketMailer_GAS_WebappURL;
    if (!gasUrl) {
      // No bridge configured — return draft body so client can copy-paste.
      return NextResponse.json({
        success: false,
        error: 'Zendesk bridge not configured',
        draftBody: description,
      }, { status: 503 });
    }

    const payload = {
      subject,
      description,
      // GAS expects customerName/customerEmail; for receiving claims there's
      // no end-customer — populate with a sentinel so the email is filed
      // under the receiving operator's name.
      customerName: 'USAV Receiving',
      customerEmail: '',
    };

    let ticketNumber: string | null = null;
    try {
      const gasRes = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!gasRes.ok) {
        return NextResponse.json({
          success: false,
          error: `Zendesk bridge HTTP ${gasRes.status}`,
          draftBody: description,
        }, { status: 502 });
      }
      const result = await gasRes.json().catch(() => null);
      if (!result?.ok) {
        return NextResponse.json({
          success: false,
          error: result?.error || 'Bridge rejected request',
          draftBody: description,
        }, { status: 502 });
      }
      const raw =
        result.ticketNumber ?? result.ticket_number ?? result.ticketId ?? result.ticket_id ?? result.id;
      if (raw == null) {
        return NextResponse.json({
          success: false,
          error: 'Bridge returned no ticket number',
          draftBody: description,
        }, { status: 502 });
      }
      ticketNumber = String(raw).startsWith('#') ? String(raw) : `#${raw}`;
    } catch (err: unknown) {
      return NextResponse.json({
        success: false,
        error: err instanceof Error ? err.message : 'Bridge request failed',
        draftBody: description,
      }, { status: 502 });
    }

    return NextResponse.json({ success: true, ticketNumber });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving/zendesk-claim');
  }
}, { permission: 'receiving.mark_received' });
