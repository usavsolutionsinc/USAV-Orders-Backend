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

    // Format date
    let startDateTime = '';
    try {
      if (repair.date_time) {
        const date = new Date(repair.date_time);
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

    const ticketNumber = repair.ticket_number || repair.id.toString();
    const productTitle = repair.product_title || '';
    const issue = repair.issue || '';
    const serialNumber = repair.serial_number || '';
    const price = repair.price || '';
    
    // Format phone number helper
    const formatPhoneNumber = (phone: string): string => {
      if (!phone) return '';
      const cleaned = phone.replace(/\D/g, '');
      if (cleaned.length === 10) {
        return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
      }
      return phone;
    };
    
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
          <p class="text-lg font-semibold">${ticketNumber} - Repair Ticket Number</p>
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
        <div class="mb-10 mt-28">
          <div class="flex items-end gap-4 mb-2">
            <span class="font-bold whitespace-nowrap">Drop Off X</span>
            <div class="flex-1 border-b border-black" style="height: 24px;"></div>
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
  <title>Repair Service - ${ticketNumber}</title>
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
