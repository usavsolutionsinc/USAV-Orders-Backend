import { NextRequest, NextResponse } from 'next/server';
import { getRepairById } from '@/lib/neon/repair-service-queries';
import { formatPhoneNumber } from '@/utils/phone';
import pool from '@/lib/db';

/**
 * GET /api/repair-service/print/[id] - Render printable repair service form
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const repairId = parseInt(id);

    if (isNaN(repairId)) {
      return NextResponse.json(
        { error: 'Invalid ID' },
        { status: 400 }
      );
    }

    const repair = await getRepairById(repairId);

    if (!repair) {
      return NextResponse.json(
        { error: 'Repair not found' },
        { status: 404 }
      );
    }

    // Format date
    let startDateTime = '';
    try {
      if (repair.created_at) {
        const date = new Date(repair.created_at);
        startDateTime = date.toLocaleString('en-US', { 
          month: '2-digit', 
          day: '2-digit', 
          year: 'numeric'
        });
      } else {
        const now = new Date();
        startDateTime = now.toLocaleString('en-US', { 
          month: '2-digit', 
          day: '2-digit', 
          year: 'numeric'
        });
      }
    } catch {
      const now = new Date();
      startDateTime = now.toLocaleString('en-US', { 
        month: '2-digit', 
        day: '2-digit', 
        year: 'numeric'
      });
    }

    // Pickup date — today (printed at pickup); falls back to repair.updated_at
    // when available so a late reprint still shows the original pickup day.
    const pickupDateTime = (() => {
      const fmt = (d: Date) =>
        d.toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
      try {
        if (repair.updated_at) {
          const u = new Date(repair.updated_at);
          if (!Number.isNaN(u.getTime())) return fmt(u);
        }
      } catch { /* ignore */ }
      return fmt(new Date());
    })();

    const repairServiceId = repair.id.toString();
    const repairServiceCode = `RS-${repairServiceId}`;
    const canonicalRsCode = `RS-${String(repair.id).padStart(4, '0')}`;
    const unpaddedRsCode = `RS-${repair.id}`;
    const ticketNumber = repair.ticket_number || '';
    const isSameRsTicket = ticketNumber === repairServiceCode || ticketNumber === canonicalRsCode;
    const externalTicketNumber = ticketNumber && !isSameRsTicket ? ticketNumber : '';
    const productTitle = repair.product_title || '';
    const issue = repair.issue || '';
    const serialNumber = repair.serial_number || '';
    const price = repair.price || '';
    
    // Parse contact_info to extract name, phone and email (format: "name, phone, email")
    let name = '';
    let phoneNumber = '';
    let email = '';
    if (repair.contact_info) {
      const parts = repair.contact_info.split(',').map((p: string) => p.trim());
      name = parts[0] || ''; // Name is index 0
      phoneNumber = formatPhoneNumber(parts[1] || ''); // Phone is index 1
      email = parts[2] || ''; // Email is index 2
    }
    
    // Format contact as "Name, Phone, Email"
    const contactDisplay = [name, phoneNumber, email].filter(Boolean).join(', ');

    // Capture the DB id outside the closure — TS narrowing of `repair`
    // doesn't carry into the nested async function.
    const repairDbId = repair.id;

    // Resolve drop-off (intake) and pickup signatures separately by document_type.
    // The intake row uses blob path "{RS-####}_<ts>.png" while pickup uses
    // "{RS-####}_pickup_<ts>.png" — older intake rows may pre-date document_type
    // discrimination, so the intake query also accepts NULL document_type.
    async function resolveSignatureUrl(
      docTypeFilter: 'intake_agreement' | 'pickup_agreement',
    ): Promise<string> {
      const blobMarker =
        docTypeFilter === 'pickup_agreement' ? '_pickup_' : '_';
      try {
        const result = await pool.query(
          `SELECT d.signature_url
           FROM documents d
           WHERE d.entity_type = 'REPAIR'
             AND d.signature_url IS NOT NULL
             AND (
               d.document_type = $5
               OR (d.document_type IS NULL AND $5 = 'intake_agreement')
             )
             AND (
               d.entity_id = $1
               OR COALESCE(d.document_data->>'ticketNumber', '') = $2
               OR d.signature_url ILIKE $3
               OR d.signature_url ILIKE $4
             )
           ORDER BY
             CASE
               WHEN d.signature_url ILIKE '%' || $6 || '%' THEN 0
               WHEN COALESCE(d.document_data->>'ticketNumber', '') = $2 THEN 1
               WHEN d.signature_url ILIKE $3 THEN 2
               WHEN d.signature_url ILIKE $4 THEN 3
               WHEN d.entity_id = $1 THEN 4
               ELSE 5
             END,
             d.created_at DESC
           LIMIT 1`,
          [
            repairDbId,
            canonicalRsCode,
            `%/${canonicalRsCode}_%`,
            `%/${unpaddedRsCode}_%`,
            docTypeFilter,
            blobMarker,
          ],
        );
        return String(result.rows[0]?.signature_url || '').trim();
      } catch (err) {
        console.warn(
          `Failed to resolve repair ${docTypeFilter} signature for RS ${canonicalRsCode}:`,
          err,
        );
        return '';
      }
    }

    const [dropoffSignatureUrl, pickupSignatureUrl] = await Promise.all([
      resolveSignatureUrl('intake_agreement'),
      resolveSignatureUrl('pickup_agreement'),
    ]);

    // Pull what was physically done on this repair (oldest-first so it reads
    // top→bottom like the work was performed). Cap at 6 rows — the printed
    // table has fixed height and more than 6 looks cramped.
    interface ActionRow {
      action_type: string;
      part_name: string | null;
      old_sku: string | null;
      new_sku: string | null;
      staff_name: string | null;
      created_at: string;
    }
    let actions: ActionRow[] = [];
    try {
      const r = await pool.query<ActionRow>(
        `SELECT a.action_type, a.part_name, a.old_sku, a.new_sku,
                s.name AS staff_name, a.created_at
           FROM repair_actions a
           LEFT JOIN staff s ON s.id = a.staff_id
          WHERE a.repair_id = $1
            AND a.deleted_at IS NULL
          ORDER BY a.created_at ASC, a.id ASC
          LIMIT 6`,
        [repair.id],
      );
      actions = r.rows;
    } catch (err) {
      console.warn(`Failed to load repair_actions for RS ${canonicalRsCode}:`, err);
    }

    const ACTION_LABEL: Record<string, string> = {
      replaced:      'Replaced',
      repaired:      'Repaired',
      cleaned:       'Cleaned',
      tested:        'Tested',
      no_fix:        'No fix',
      awaiting_part: 'Awaiting part',
    };
    function escapeHtml(s: string): string {
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
    const actionRowsHtml = actions.length
      ? actions
          .map((a) => {
            const what = a.part_name
              ? `${ACTION_LABEL[a.action_type] || a.action_type}: ${a.part_name}`
              : ACTION_LABEL[a.action_type] || a.action_type;
            const detail =
              a.action_type === 'replaced' && (a.old_sku || a.new_sku)
                ? `${a.old_sku || '—'} → ${a.new_sku || '—'}`
                : '';
            const who = a.staff_name || '';
            const when = a.created_at
              ? new Date(a.created_at).toLocaleDateString('en-US', {
                  month: '2-digit',
                  day: '2-digit',
                  year: '2-digit',
                })
              : '';
            return `<div class="flex border-b border-r border-black">
              <div class="flex-1 border-r border-black p-2">${escapeHtml(what)}</div>
              <div class="flex-1 border-r border-black p-2">${escapeHtml(detail)}</div>
              <div class="flex-1 border-r border-black p-2">${escapeHtml(who)}</div>
              <div class="flex-1 border-r border-black p-2">${escapeHtml(when)}</div>
            </div>`;
          })
          .join('')
      : `<div class="flex border-b border-r border-black">
          <div class="flex-1 border-r border-black p-2">&nbsp;</div>
          <div class="flex-1 border-r border-black p-2">&nbsp;</div>
          <div class="flex-1 border-r border-black p-2">&nbsp;</div>
          <div class="flex-1 border-r border-black p-2">&nbsp;</div>
        </div>`;

    // Generate HTML matching Repair Service Paper exactly
    const formHtml = `
      <div class="bg-white text-gray-900 font-sans p-8">

        <!-- Header Section -->
        <div class="text-right mb-8">
          <h2 class="font-bold text-lg">USAV Solutions</h2>
          <p class="text-sm">16161 Gothard St. Suite A</p>
          <p class="text-sm">Huntington Beach, CA 92647, United States</p>
          <p class="text-sm">Tel: (714) 596-6888</p>
        </div>

        <!-- Title and Ticket Number -->
        <div class="mb-6">
          <h1 class="text-3xl font-bold mb-2">Repair Service</h1>
          ${externalTicketNumber ? `<p class="text-sm font-medium text-gray-600">Ticket #: ${externalTicketNumber}</p>` : ''}
        </div>

        <!-- Information Table -->
        <div class="border-t border-l border-black mb-6">
          <div class="flex border-b border-r border-black">
            <div class="w-40 p-2 font-bold bg-gray-50 border-r border-black">Product Title:</div>
            <div class="flex-1 p-2">${productTitle}</div>
          </div>
          <div class="flex border-b border-r border-black">
            <div class="w-40 p-2 font-bold bg-gray-50 border-r border-black">SN & Issues:</div>
            <div class="flex-1 p-2">${serialNumber}, ${issue}</div>
          </div>
          <div class="flex border-b border-r border-black">
            <div class="w-40 p-2 font-bold bg-gray-50 border-r border-black">Contact Info:</div>
            <div class="flex-1 p-2">${contactDisplay}</div>
          </div>
        </div>

        <!-- Price Section -->
        <div class="mb-6">
          <p class="text-lg font-medium mb-2">
            <span class="font-bold">$${price}</span> - Price Paid at Pick-up
          </p>
          <p class="text-base font-medium">
            Card / Cash - Payment Method
          </p>
        </div>

        <!-- Terms & Warranty -->
        <div class="mb-10 text-sm leading-relaxed">
          <p class="mb-4">
            Your Bose product has been received into our repair center. Under normal circumstances it will 
            be repaired within the next 3-10 working days and returned to you at the address above.
          </p>
          <p class="font-bold border-b border-black inline-block">
            There is a 30 day Warranty on all our repair services.
          </p>
        </div>

        <!-- Drop Off Section -->
        <div class="mb-10 mt-12">
          <div class="flex items-end gap-4 mb-2">
            <span class="font-bold whitespace-nowrap">Drop Off X</span>
            <div class="flex-1 border-b-2 border-black relative overflow-hidden" style="height: 96px;">
              ${dropoffSignatureUrl ? `<img src="${dropoffSignatureUrl}" alt="Drop off signature for ${canonicalRsCode}" style="position:absolute;bottom:2px;left:0;height:90px;max-width:100%;width:auto;object-fit:contain;filter:contrast(2.2) brightness(0.55) saturate(0);" />` : ''}
            </div>
            <span class="font-bold whitespace-nowrap">Date: ${startDateTime}</span>
          </div>
          <p class="text-xs italic">
            By signing above you agree to the listed price and any unexpected delays in the repair process.
          </p>
        </div>

        <!-- Internal Use Table -->
        <div class="border-t border-l border-black mb-10">
          <div class="flex border-b border-r border-black bg-gray-50">
            <div class="flex-1 border-r border-black p-2 font-bold">Part Repaired</div>
            <div class="flex-1 border-r border-black p-2 font-bold">Detail</div>
            <div class="flex-1 border-r border-black p-2 font-bold">Who</div>
            <div class="flex-1 border-r border-black p-2 font-bold">Date</div>
          </div>
          ${actionRowsHtml}
        </div>

        <!-- Pick Up Section -->
        <div class="mt-32">
          <div class="flex items-end gap-4 mb-4">
            <span class="font-bold whitespace-nowrap">Pick Up X</span>
            <div class="flex-1 border-b-2 border-black relative overflow-hidden" style="height: 96px;">
              ${pickupSignatureUrl ? `<img src="${pickupSignatureUrl}" alt="Pickup signature for ${canonicalRsCode}" style="position:absolute;bottom:2px;left:0;height:90px;max-width:100%;width:auto;object-fit:contain;filter:contrast(2.2) brightness(0.55) saturate(0);" />` : ''}
            </div>
            <span class="font-bold whitespace-nowrap">Date: ${pickupDateTime}</span>
          </div>
          <p class="text-center font-bold text-xl mt-8">Enjoy your repaired unit!</p>
        </div>

      </div>
    `;

    // Return full HTML page with print styles
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Repair Service - ${repairServiceCode}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    html, body {
      width: 8.5in;
      height: 11in;
      margin: 0;
      padding: 0;
    }
    @media print {
      html, body {
        width: 8.5in;
        height: 11in;
        margin: 0;
        padding: 0;
      }
      @page {
        size: 8.5in 11in;
        margin: 0;
      }
    }
  </style>
  <script>
    window.onload = function() { window.print(); };
  </script>
</head>
<body>
  ${formHtml}
</body>
</html>
    `;

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
      },
    });
  } catch (error: any) {
    console.error(`Error rendering repair form:`, error);
    return NextResponse.json(
      { error: 'Failed to render repair form', details: error.message },
      { status: 500 }
    );
  }
}
