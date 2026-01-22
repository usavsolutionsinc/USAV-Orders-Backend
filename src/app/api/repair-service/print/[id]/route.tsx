import { NextRequest, NextResponse } from 'next/server';
import { getRepairById } from '@/lib/neon/repair-service-queries';
import RepairServiceForm from '@/components/repair/RepairServiceForm';
import { renderToString } from 'react-dom/server';

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

    // Render the React component to HTML string
    const formHtml = renderToString(
      RepairServiceForm({
        ticketNumber: repair.ticket_number || repair.id.toString(),
        productTitle: repair.product_title || '',
        issue: repair.issue || '',
        serialNumber: repair.serial_number || '',
        name: repair.name || '',
        contact: repair.contact || '',
        price: repair.price || '',
        startDateTime: startDateTime,
      })
    );

    // Return full HTML page with print styles
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Repair Service - ${repair.ticket_number}</title>
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
