import { NextRequest, NextResponse } from 'next/server';
import { getRepairById } from '@/lib/neon/repair-service-queries';
import { formatPhoneNumber } from '@/utils/phone';
import pool from '@/lib/db';
import { buildRepairDetailsDeepLink } from '@/lib/repair/repair-deep-link';

/**
 * GET /api/repair-service/print/[id] - Render printable repair service form
 */
export async function GET(
  req: NextRequest,
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

    // Resolve signature by RS code first (blob path + document_data ticketNumber),
    // then fall back to direct repair entity linkage.
    let signatureUrl = '';
    try {
      const signatureResult = await pool.query(
        `SELECT d.signature_url
         FROM documents d
         WHERE d.entity_type = 'REPAIR'
           AND d.signature_url IS NOT NULL
           AND (
             d.entity_id = $1
             OR COALESCE(d.document_data->>'ticketNumber', '') = $2
             OR d.signature_url ILIKE $3
             OR d.signature_url ILIKE $4
           )
         ORDER BY
           CASE
             WHEN COALESCE(d.document_data->>'ticketNumber', '') = $2 THEN 0
             WHEN d.signature_url ILIKE $3 THEN 1
             WHEN d.signature_url ILIKE $4 THEN 2
             WHEN d.entity_id = $1 THEN 3
             ELSE 4
           END,
           d.created_at DESC
         LIMIT 1`,
        [
          repair.id,
          canonicalRsCode,
          `%/${canonicalRsCode}_%`,
          `%/${unpaddedRsCode}_%`,
        ],
      );
      signatureUrl = String(signatureResult.rows[0]?.signature_url || '').trim();
    } catch (signatureError) {
      console.warn(`Failed to resolve repair signature for RS ${canonicalRsCode}:`, signatureError);
    }

    const repairManageUrl = buildRepairDetailsDeepLink(repair.id, req.nextUrl.origin);
    const repairManageUrlJson = JSON.stringify(repairManageUrl);

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
        <div class="mb-6 flex items-start justify-between gap-6">
          <div>
            <h1 class="text-3xl font-bold mb-2">Repair Service</h1>
            <p class="text-lg font-semibold">${repairServiceCode} - Repair Service Number</p>
            ${externalTicketNumber ? `<p class="text-sm font-medium text-gray-600">Ticket #: ${externalTicketNumber}</p>` : ''}
          </div>
          <div class="flex flex-col items-end">
            <canvas id="rs-qr" width="132" height="132"></canvas>
            <p class="mt-1 text-center text-xs font-semibold tracking-[0.2em] text-gray-500">Scan to update</p>
            <p class="mt-0.5 text-center text-[10px] font-bold text-gray-400">${repairServiceCode}</p>
          </div>
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
            <div class="flex-1 border-b border-black relative overflow-hidden" style="height: 56px;">
              ${signatureUrl ? `<img src="${signatureUrl}" alt="Drop off signature for ${canonicalRsCode}" style="position:absolute;bottom:2px;left:0;max-height:50px;max-width:100%;width:auto;object-fit:contain;" />` : ''}
            </div>
            <span class="font-bold whitespace-nowrap">Date: ${startDateTime}</span>
          </div>
          <p class="text-xs italic">
            By signing above you agree to the listed price and any unexpected delays in the repair process.
          </p>
        </div>

        <!-- Internal Use Table -->
        <div class="border-t border-l border-black mb-10 flex">
          <div class="flex-1 border-r border-b border-black p-2 font-bold">Part Repaired:</div>
          <div class="flex-1 border-r border-b border-black p-2"></div>
          <div class="flex-1 border-r border-b border-black p-2 font-bold">Who:</div>
          <div class="flex-1 border-r border-b border-black p-2 font-bold">Date:</div>
        </div>

        <!-- Pick Up Section -->
        <div class="mt-32">
          <div class="flex items-end gap-4 mb-4">
            <span class="font-bold whitespace-nowrap">Pick Up X</span>
            <div class="flex-1 border-b border-black" style="height: 24px;"></div>
            <span class="font-bold whitespace-nowrap">Date: ____ / ____ / ________</span>
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
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
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
    window.onload = function() {
      var url = ${repairManageUrlJson};
      var canvas = document.getElementById("rs-qr");
      var startPrint = function() { window.print(); };
      if (window.QRCode && canvas) {
        window.QRCode.toCanvas(canvas, url, { margin: 2, width: 120, color: { dark: "#111827", light: "#ffffff" } }, function (err) {
          if (err) console.warn("Repair QR render failed", err);
          startPrint();
        });
      } else {
        startPrint();
      }
    }
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
