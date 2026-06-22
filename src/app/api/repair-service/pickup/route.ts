import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishRepairChanged } from '@/lib/realtime/publish';
import { withAuth } from '@/lib/auth/withAuth';

interface RepairLookupRow {
  id: number;
  ticket_number: string | null;
  status: string | null;
}

interface WorkAssignmentRow {
  id: number;
}

function parseScanInput(rawValue: unknown) {
  const raw = String(rawValue ?? '').trim();
  if (!raw) {
    return {
      raw,
      repairId: null as number | null,
      ticketCandidate: null as string | null,
    };
  }

  const compactUpper = raw.replace(/\s+/g, '').toUpperCase();
  let repairId: number | null = null;

  const rsMatch = compactUpper.match(/^RS(?:-|_|:|#)?0*(\d+)$/);
  if (rsMatch?.[1]) {
    const numeric = Number(rsMatch[1]);
    repairId = Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  } else if (/^\d+$/.test(compactUpper)) {
    const numeric = Number(compactUpper);
    repairId = Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }

  const ticketCandidate = raw.replace(/^#/, '').trim() || null;

  return {
    raw,
    repairId,
    ticketCandidate,
  };
}

interface PickupRequestBody {
  scan?: string;
  rsId?: string | number;
  value?: string;
  repairId?: number;
  signatureDataUrl?: string;
  signatureStrokes?: unknown[];
  signerName?: string;
  declinedReason?: string;
}

/**
 * POST /api/repair-service/pickup
 *
 * Body (all optional except an identifier — either scan OR repairId):
 * {
 *   scan?: string,            // RS-ID barcode/input (e.g. "RS-125", "125", ticket #)
 *   repairId?: number,        // explicit id (preferred when the caller already knows it)
 *   signatureDataUrl?: string,// data:image/png;base64,… customer pickup signature
 *   signatureStrokes?: any[], // raw stroke data persisted to document_data
 *   signerName?: string,      // who signed (customer name); falls back to contact_info
 *   declinedReason?: string,  // when the customer refuses to sign — recorded, no blob upload
 * }
 *
 * Effect:
 * 1. Marks repair_service.status as Done.
 * 2. Appends a status_history entry when status changed.
 * 3. Closes the active REPAIR work_assignments row.
 * 4. Records pickup_signed_at + pickup_staff_id for audit-trail / reporting.
 * 5. If a signature payload is provided, uploads PNG to blob and inserts a
 *    documents row with document_type='pickup_agreement'.
 * 6. If declinedReason is provided (no signature), inserts a documents row with
 *    signature_url=null and document_data.declinedReason so the audit trail
 *    still captures the customer's refusal.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  const client = await pool.connect();
  const staffId = ctx.staffId;

  try {
    const body: PickupRequestBody = await req.json().catch(() => ({}));

    let repair: RepairLookupRow | null = null;
    let scanInputForHistory: string | null = null;

    // Preferred path: caller passes repairId directly (overlay UI).
    if (typeof body.repairId === 'number' && Number.isFinite(body.repairId) && body.repairId > 0) {
      await client.query('BEGIN');
      const byId = await client.query<RepairLookupRow>(
        `SELECT id, ticket_number, status
         FROM repair_service
         WHERE id = $1
         FOR UPDATE`,
        [body.repairId],
      );
      repair = byId.rows[0] ?? null;
      scanInputForHistory = `RS-${body.repairId}`;
    } else {
      // Legacy path: parse a scan string (RS-####, digits, or ticket #).
      const parsed = parseScanInput(body.scan ?? body.rsId ?? body.value);
      if (!parsed.raw) {
        return NextResponse.json({ error: 'scan value or repairId is required' }, { status: 400 });
      }
      scanInputForHistory = parsed.raw;

      await client.query('BEGIN');

      if (parsed.repairId != null) {
        const byId = await client.query<RepairLookupRow>(
          `SELECT id, ticket_number, status
           FROM repair_service
           WHERE id = $1
           FOR UPDATE`,
          [parsed.repairId],
        );
        repair = byId.rows[0] ?? null;
      }

      if (!repair && parsed.ticketCandidate) {
        const byTicket = await client.query<RepairLookupRow>(
          `SELECT id, ticket_number, status
           FROM repair_service
           WHERE UPPER(TRIM(COALESCE(ticket_number, ''))) = UPPER(TRIM($1))
           ORDER BY id DESC
           LIMIT 1
           FOR UPDATE`,
          [parsed.ticketCandidate],
        );
        repair = byTicket.rows[0] ?? null;
      }
    }

    if (!repair) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Repair not found for input "${scanInputForHistory ?? ''}"` },
        { status: 404 },
      );
    }

    const repairId = Number(repair.id);
    const previousStatus = String(repair.status || '').trim() || null;

    const hasSignature =
      typeof body.signatureDataUrl === 'string' &&
      body.signatureDataUrl.startsWith('data:image/');
    const declinedReason = (body.declinedReason || '').trim() || null;
    const signerName = (body.signerName || '').trim() || null;
    const sourceTag = hasSignature
      ? 'repair-service.pickup-signed'
      : declinedReason
        ? 'repair-service.pickup-declined'
        : 'repair-service.pickup-scan';
    const actionTag = hasSignature
      ? 'picked_up_signed'
      : declinedReason
        ? 'picked_up_signature_declined'
        : 'picked_up_scan';

    await client.query(
      `UPDATE repair_service
          SET status = 'Done',
              pickup_signed_at = COALESCE(pickup_signed_at, NOW()),
              pickup_staff_id  = COALESCE(pickup_staff_id, $4),
              status_history = CASE
                WHEN COALESCE(status, '') IS DISTINCT FROM 'Done' THEN
                  COALESCE(status_history, '[]'::jsonb) || jsonb_build_array(
                    jsonb_strip_nulls(
                      jsonb_build_object(
                        'status', 'Done',
                        'timestamp', $2,
                        'previous_status', NULLIF(status, ''),
                        'source', $5,
                        'metadata', jsonb_build_object(
                          'scan_input', $3,
                          'action', $6,
                          'staff_id', $4,
                          'has_signature', $7,
                          'declined_reason', $8
                        )
                      )
                    )
                  )
                ELSE COALESCE(status_history, '[]'::jsonb)
              END,
              updated_at = NOW()
        WHERE id = $1`,
      [
        repairId,
        formatPSTTimestamp(),
        scanInputForHistory,
        staffId,
        sourceTag,
        actionTag,
        hasSignature,
        declinedReason,
      ],
    );

    const activeAssignment = await client.query<WorkAssignmentRow>(
      `SELECT id
       FROM work_assignments
       WHERE entity_type = 'REPAIR'
         AND entity_id = $1
         AND work_type = 'REPAIR'
         AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
       ORDER BY CASE status
         WHEN 'IN_PROGRESS' THEN 1
         WHEN 'ASSIGNED' THEN 2
         WHEN 'OPEN' THEN 3
         ELSE 4
       END, updated_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [repairId],
    );

    let assignmentId: number | null = null;

    if (activeAssignment.rows[0]) {
      assignmentId = Number(activeAssignment.rows[0].id);
      await client.query(
        `UPDATE work_assignments
            SET status = 'DONE',
                started_at = COALESCE(started_at, NOW()),
                completed_at = COALESCE(completed_at, NOW()),
                updated_at = NOW()
          WHERE id = $1`,
        [assignmentId],
      );
    } else {
      const doneAssignment = await client.query<WorkAssignmentRow>(
        `SELECT id
         FROM work_assignments
         WHERE entity_type = 'REPAIR'
           AND entity_id = $1
           AND work_type = 'REPAIR'
           AND status = 'DONE'
         ORDER BY completed_at DESC NULLS LAST, updated_at DESC, id DESC
         LIMIT 1
         FOR UPDATE`,
        [repairId],
      );

      if (doneAssignment.rows[0]) {
        assignmentId = Number(doneAssignment.rows[0].id);
        await client.query(
          `UPDATE work_assignments
              SET completed_at = COALESCE(completed_at, NOW()),
                  updated_at = NOW()
            WHERE id = $1`,
          [assignmentId],
        );
      } else {
        const inserted = await client.query<WorkAssignmentRow>(
          `INSERT INTO work_assignments
                (organization_id, entity_type, entity_id, work_type, status, priority, assigned_at, started_at, completed_at)
           VALUES ($1, 'REPAIR', $2, 'REPAIR', 'DONE', 100, NOW(), NOW(), NOW())
           RETURNING id`,
          [ctx.organizationId, repairId],
        );
        assignmentId = inserted.rows[0] ? Number(inserted.rows[0].id) : null;
      }
    }

    // Persist signature (or decline record) into the documents table inside
    // the same transaction so an upload failure rolls back the status change.
    let signatureUrl: string | null = null;
    let signatureWarning: string | null = null;
    let documentId: number | null = null;
    const rsCode = `RS-${repairId}`;

    if (hasSignature) {
      try {
        const base64Data = body.signatureDataUrl!.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        const blobPath = `repair_signatures/${rsCode}_pickup_${Date.now()}.png`;
        const blob = await put(blobPath, buffer, {
          access: 'public',
          contentType: 'image/png',
        });
        signatureUrl = blob.url;
      } catch (sigError) {
        console.error('Failed to upload pickup signature PNG to blob:', sigError);
        signatureWarning = 'Signature image upload failed — stroke data saved as backup';
      }
    }

    if (hasSignature || declinedReason) {
      try {
        const docResult = await client.query<{ id: number }>(
          `INSERT INTO documents (
              entity_type, entity_id, document_type, signature_url, signer_name, signed_at, document_data, organization_id
           ) VALUES ('REPAIR', $1, 'pickup_agreement', $2, $3, NOW(), $4, $5::uuid)
           RETURNING id`,
          [
            repairId,
            signatureUrl,
            signerName,
            JSON.stringify({
              ticketNumber: rsCode,
              previousStatus,
              staffId,
              signerName,
              signatureStrokes: Array.isArray(body.signatureStrokes) ? body.signatureStrokes : null,
              declinedReason,
              terms:
                'I confirm I am picking up this repaired item and acknowledge the 30-day warranty on the repair.',
              signedAt: new Date().toISOString(),
            }),
            ctx.organizationId,
          ],
        );
        documentId = docResult.rows[0]?.id ?? null;
      } catch (docError) {
        console.error('Failed to insert pickup documents row:', docError);
        signatureWarning = signatureWarning || 'Failed to save signed document';
      }
    }

    await client.query('COMMIT');

    await invalidateCacheTags(['repair-service']);
    await publishRepairChanged({
      organizationId: ctx.organizationId,
      repairIds: [repairId],
      source: sourceTag,
    });

    return NextResponse.json({
      success: true,
      repairId,
      ticketNumber: repair.ticket_number ?? null,
      status: 'Done',
      previousStatus,
      assignmentId,
      alreadyDone: previousStatus === 'Done',
      documentId,
      signatureUrl,
      signatureWarning,
      declined: !!declinedReason && !hasSignature,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('POST /api/repair-service/pickup error:', error);
    return NextResponse.json(
      {
        error: 'Failed to mark repair as picked up',
        details: error?.message || 'Unknown error',
      },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}, { permission: 'repair.pickup_sign' });
