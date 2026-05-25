/**
 * POST /api/admin/po-gmail/create-zoho-draft/[id]
 *
 * Creates a Zoho purchase order in `draft` status from the extracted fields
 * on a PO-mailbox row. Operator opens the draft in Zoho, finishes line
 * items + vendor confirmation, and clicks "Convert to Open" to publish.
 *
 * Resolution flow:
 *   1. Load the mailbox row + triage_state.
 *   2. Resolve vendor: body.vendor_id wins; otherwise look up the extracted
 *      vendor name in Zoho contacts. Exactly 1 vendor match = auto-use.
 *      0 matches → 422 (operator must create vendor in Zoho first).
 *      >1 matches → 422 with candidate list; operator re-submits with vendor_id.
 *   3. Build line items: body.line_items wins. Otherwise emit a single stub
 *      ("Items per email body" qty 1, rate 0) so Zoho accepts the create.
 *      Drafts are editable in Zoho — operator finishes the real lines there.
 *   4. POST to Zoho create-PO. Defaults to draft status.
 *   5. Write zoho_uploaded_po_number back onto the mailbox row. Leave pile
 *      as 'upload' — it flips to 'done' only after the operator publishes
 *      the draft and the existing Phase 5 cron picks it up via the Zoho
 *      mirror's PO sync.
 *
 * Request body (all optional — every field has a sensible derivation):
 *   {
 *     vendor_id?: string,           // explicit vendor (skips name lookup)
 *     date?: 'YYYY-MM-DD',          // PO date (default: today PST)
 *     reference_number?: string,    // vendor's own ref / their PO# (default: extracted PO# from email)
 *     notes?: string,               // free text (default: "Drafted from Gmail message <id>")
 *     line_items?: [{ name, rate, quantity, description? }],
 *   }
 *
 * Response 200: { success, purchaseorder_id, purchaseorder_number, status, zohoUrl }
 * Response 422: { success: false, error, code: 'VENDOR_NOT_FOUND' | 'VENDOR_AMBIGUOUS', vendor_query?, candidates? }
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import {
  createPurchaseOrder,
  searchVendorsByName,
  type CreatePurchaseOrderLine,
} from '@/lib/zoho';

interface MailboxRow {
  id: string;
  gmail_msg_id: string;
  po_numbers: string[];
  triage_state: Record<string, unknown>;
  zoho_uploaded_po_number: string | null;
}

interface RequestBody {
  vendor_id?: string;
  date?: string;
  reference_number?: string;
  notes?: string;
  line_items?: CreatePurchaseOrderLine[];
}

function readFieldValue(
  state: Record<string, unknown>,
  field: string,
): string | null {
  const fields = state?.fields;
  if (!fields || typeof fields !== 'object') return null;
  const entry = (fields as Record<string, unknown>)[field];
  if (!entry || typeof entry !== 'object') return null;
  const val = (entry as { value?: unknown }).value;
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

function pathRowId(url: URL): string | null {
  const segs = url.pathname.split('/');
  const idx = segs.indexOf('create-zoho-draft');
  if (idx < 0 || idx + 1 >= segs.length) return null;
  return decodeURIComponent(segs[idx + 1]!) || null;
}

function buildZohoUrl(purchaseOrderId: string): string {
  // Best-effort deep link — the actual Zoho org URL is per-tenant; we use the
  // common app subdomain pattern. Operators can bookmark their org URL if
  // they prefer a different shell.
  return `https://inventory.zoho.com/app/#/purchaseorders/${encodeURIComponent(purchaseOrderId)}`;
}

export const POST = withAuth(async (request: NextRequest, ctx) => {
  const rowId = pathRowId(request.nextUrl);
  if (!rowId) {
    return NextResponse.json({ success: false, error: 'invalid path' }, { status: 400 });
  }

  let body: RequestBody = {};
  try {
    body = ((await request.json().catch(() => ({}))) as RequestBody) ?? {};
  } catch {
    /* empty body is fine — every field is optional */
  }

  // ─── Load the mailbox row ───────────────────────────────────────────────────
  const rowRes = await pool.query<MailboxRow>(
    `SELECT id, gmail_msg_id, po_numbers, triage_state, zoho_uploaded_po_number
       FROM email_missing_purchase_orders
      WHERE id = $1
        AND organization_id = $2
      LIMIT 1`,
    [rowId, ctx.organizationId],
  );
  const row = rowRes.rows[0];
  if (!row) {
    return NextResponse.json(
      { success: false, error: 'mailbox row not found' },
      { status: 404 },
    );
  }

  if (row.zoho_uploaded_po_number) {
    return NextResponse.json(
      {
        success: true,
        already_drafted: true,
        purchaseorder_number: row.zoho_uploaded_po_number,
      },
    );
  }

  const triage = (row.triage_state ?? {}) as Record<string, unknown>;
  const extractedVendor = readFieldValue(triage, 'vendor');
  const extractedDate = readFieldValue(triage, 'po_date');

  // ─── Resolve vendor (body wins; else search by extracted name) ──────────────
  let vendorId = body.vendor_id?.trim() || null;
  if (!vendorId) {
    if (!extractedVendor) {
      return NextResponse.json(
        {
          success: false,
          error: 'No vendor available. Extract fields first or pass vendor_id in the body.',
          code: 'VENDOR_MISSING',
        },
        { status: 422 },
      );
    }
    const matches = await searchVendorsByName(extractedVendor, 5);
    if (matches.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `No Zoho vendor matched "${extractedVendor}". Create the vendor in Zoho first, then retry.`,
          code: 'VENDOR_NOT_FOUND',
          vendor_query: extractedVendor,
        },
        { status: 422 },
      );
    }
    if (matches.length > 1) {
      return NextResponse.json(
        {
          success: false,
          error: `Multiple Zoho vendors matched "${extractedVendor}". Re-submit with vendor_id.`,
          code: 'VENDOR_AMBIGUOUS',
          vendor_query: extractedVendor,
          candidates: matches,
        },
        { status: 422 },
      );
    }
    vendorId = matches[0]!.contact_id;
  }

  // ─── Date (body > extracted > today) ────────────────────────────────────────
  let date: string | undefined = body.date?.trim() || undefined;
  if (!date && extractedDate) {
    // Best-effort parse of common formats — Zoho wants YYYY-MM-DD.
    const parsed = new Date(extractedDate);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed.toISOString().slice(0, 10);
    }
  }

  // ─── Line items (body > stub) ───────────────────────────────────────────────
  const lineItems: CreatePurchaseOrderLine[] =
    body.line_items && body.line_items.length > 0
      ? body.line_items
      : [
          {
            name: 'Items per email body',
            description: `Drafted from Gmail message ${row.gmail_msg_id} (${row.po_numbers?.join(', ') || 'no PO #'}). Replace with real line items in Zoho before publishing.`,
            rate: 0,
            quantity: 1,
          },
        ];

  // ─── Vendor's reference (extracted PO# is a sensible default) ───────────────
  const referenceNumber =
    body.reference_number?.trim() ||
    (row.po_numbers?.[0] ? String(row.po_numbers[0]) : undefined);

  const notes =
    body.notes?.trim() ||
    `Drafted via PO-mailbox automation from Gmail message ${row.gmail_msg_id}.`;

  // ─── Create the draft ───────────────────────────────────────────────────────
  let created;
  try {
    created = await createPurchaseOrder({
      vendor_id: vendorId,
      date,
      reference_number: referenceNumber,
      notes,
      line_items: lineItems,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'create failed';
    console.error('[create-zoho-draft] Zoho create failed', {
      rowId,
      vendorId,
      message,
    });
    return NextResponse.json(
      { success: false, error: `Zoho create failed: ${message}` },
      { status: 502 },
    );
  }

  // ─── Write the PO# back onto the mailbox row ────────────────────────────────
  // pile stays as 'upload' — published-and-resolved happens later via the
  // Phase 5 reconcile cron when the published PO shows up in the mirror.
  try {
    await pool.query(
      `UPDATE email_missing_purchase_orders
          SET zoho_uploaded_po_number = $1,
              zoho_uploaded_at        = NOW(),
              pile                    = CASE WHEN pile = 'inbox' THEN 'upload' ELSE pile END
        WHERE id = $2
          AND organization_id = $3`,
      [created.purchaseorder_number, rowId, ctx.organizationId],
    );
  } catch (err) {
    // The draft was created successfully; the writeback failure is not fatal
    // for the operator (they have the PO# in the response). Log + continue.
    console.warn('[create-zoho-draft] writeback failed', {
      rowId,
      poNumber: created.purchaseorder_number,
      err: err instanceof Error ? err.message : err,
    });
  }

  return NextResponse.json({
    success: true,
    purchaseorder_id: created.purchaseorder_id,
    purchaseorder_number: created.purchaseorder_number,
    status: created.status,
    vendor_id: created.vendor_id,
    zohoUrl: buildZohoUrl(created.purchaseorder_id),
  });
}, { permission: 'admin.view' });
