import { NextRequest, NextResponse } from 'next/server';
import { getRepairById } from '@/lib/neon/repair-service-queries';

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

    // Parse date_time JSON if it exists
    let startDateTime = '';
    try {
      const dateTimeData = repair.date_time ? JSON.parse(repair.date_time) : {};
      startDateTime = dateTimeData.start || new Date().toLocaleDateString();
    } catch {
      startDateTime = new Date().toLocaleDateString();
    }

    const ticketNumber = repair.ticket_number || repair.id.toString();
    const productTitle = repair.product_title || '';
    const issue = repair.issue || '';
    const serialNumber = repair.serial_number || '';
    const name = repair.name || '';
    const contact = repair.contact || '';
    const price = repair.price || '';

    // Generate HTML directly
    const formHtml = `
      <div class="bg-white p-6 print:p-6">
        <div class="max-w-4xl mx-auto">
          <!-- Header -->
          <div class="text-center mb-8 border-b-2 border-gray-300 pb-6">
            <h1 class="text-3xl font-bold text-gray-900 mb-2">USAV Solutions Inc.</h1>
            <p class="text-lg text-gray-600">Repair Service Form</p>
            <p class="text-sm text-gray-500 mt-2">Ticket #${ticketNumber}</p>
          </div>

          <!-- Customer Information -->
          <div class="mb-6">
            <h2 class="text-xl font-bold text-gray-800 mb-4 border-b border-gray-200 pb-2">Customer Information</h2>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Name</label>
                <div class="text-base text-gray-900 bg-gray-50 px-4 py-2 rounded border border-gray-200">${name || '_______________'}</div>
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Contact</label>
                <div class="text-base text-gray-900 bg-gray-50 px-4 py-2 rounded border border-gray-200">${contact || '_______________'}</div>
              </div>
            </div>
          </div>

          <!-- Product Information -->
          <div class="mb-6">
            <h2 class="text-xl font-bold text-gray-800 mb-4 border-b border-gray-200 pb-2">Product Information</h2>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Product Title</label>
                <div class="text-base text-gray-900 bg-gray-50 px-4 py-2 rounded border border-gray-200">${productTitle || '_______________'}</div>
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Serial Number</label>
                <div class="text-base text-gray-900 bg-gray-50 px-4 py-2 rounded border border-gray-200">${serialNumber || '_______________'}</div>
              </div>
            </div>
          </div>

          <!-- Issue Description -->
          <div class="mb-6">
            <h2 class="text-xl font-bold text-gray-800 mb-4 border-b border-gray-200 pb-2">Issue Description</h2>
            <div class="text-base text-gray-900 bg-gray-50 px-4 py-4 rounded border border-gray-200 min-h-32">${issue || '_______________'}</div>
          </div>

          <!-- Service Information -->
          <div class="mb-6">
            <h2 class="text-xl font-bold text-gray-800 mb-4 border-b border-gray-200 pb-2">Service Information</h2>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Date/Time</label>
                <div class="text-base text-gray-900 bg-gray-50 px-4 py-2 rounded border border-gray-200">${startDateTime || '_______________'}</div>
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">Price</label>
                <div class="text-base text-gray-900 bg-gray-50 px-4 py-2 rounded border border-gray-200">${price || '_______________'}</div>
              </div>
            </div>
          </div>

          <!-- Signature Section -->
          <div class="mt-8 pt-6 border-t-2 border-gray-300">
            <div class="grid grid-cols-2 gap-8">
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-2">Technician Signature</label>
                <div class="border-b-2 border-gray-400 h-12"></div>
                <p class="text-xs text-gray-500 mt-1">Date: _____________</p>
              </div>
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-2">Customer Signature</label>
                <div class="border-b-2 border-gray-400 h-12"></div>
                <p class="text-xs text-gray-500 mt-1">Date: _____________</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Return full HTML page with print styles
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Repair Service - ${ticketNumber}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @media print {
      body { margin: 0; padding: 0; }
      .print\\:p-6 { padding: 1.5rem !important; }
    }
    @page {
      size: letter;
      margin: 0;
    }
  </style>
  <script>
    window.onload = function() {
      window.print();
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
