import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createZendeskTicket } from '@/lib/zendesk';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { customer, product, repairReasons, repairNotes, serialNumber, price, notes } = body;

        // Validate required fields (email is optional)
        if (!customer?.name || !customer?.phone || !product?.type || !product?.model || !repairReasons?.length || !serialNumber || !price) {
            const missing = [];
            if (!customer?.name) missing.push('Name');
            if (!customer?.phone) missing.push('Phone');
            if (!product?.type || !product?.model) missing.push('Product Title');
            if (!repairReasons?.length) missing.push('Repair Reasons');
            if (!serialNumber) missing.push('Serial #');
            if (!price) missing.push('Price');

            return NextResponse.json({ 
                error: `Missing required fields: ${missing.join(', ')}` 
            }, { status: 400 });
        }

        // Format date/time (MM/DD/YYYY HH:mm:ss)
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const year = now.getFullYear();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const formattedDateTime = `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;

        // Format product string
        const productString = product.type === 'Other' 
            ? product.model 
            : `${product.type} Music System - ${product.model}`;

        // Format contact info (email is optional)
        const contactInfo = customer.email 
            ? `${customer.name}, ${customer.phone}, ${customer.email}`
            : `${customer.name}, ${customer.phone}`;

        // Format issue (repair reasons + repair notes from step 2)
        const issueString = repairReasons.join(', ') + (repairNotes ? ` - ${repairNotes}` : '');

        // Step 1: Create Zendesk ticket via GAS Web App
        // Note: Currently unable to retrieve ticket number from Zendesk, using "NA"
        let zendeskTicketNumber: string = 'NA';
        try {
            await createZendeskTicket({
                customerName: customer.name,
                customerPhone: customer.phone,
                customerEmail: customer.email || '', // Optional
                productTitle: productString,
                contactInfo: contactInfo,
                issue: issueString,
                serialNumber,
                price,
                notes: notes || '' // Optional notes from step 3
            });
            // Ticket created but number not retrieved, using NA
            console.log('✅ Zendesk ticket created (ticket number: NA)');
        } catch (error: any) {
            console.error('Failed to create Zendesk ticket:', error);
            // Continue with DB insert even if Zendesk fails
        }

        // Step 2: Insert into repair_service table in NEON DB
        console.log('📝 Inserting repair service:', {
            date_time: formattedDateTime,
            ticket_number: zendeskTicketNumber,
            contact_info: contactInfo,
            product_title: productString,
            price: price || '130',
            issue: issueString,
            serial_number: serialNumber || '',
            notes: notes || '',
            status: 'Pending Repair'
        });

        const insertResult = await pool.query(`
            INSERT INTO repair_service (date_time, ticket_number, contact_info, product_title, price, issue, serial_number, notes, process, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, ticket_number
        `, [
            JSON.stringify(formattedDateTime), // date_time (JSON)
            zendeskTicketNumber,               // ticket_number (TEXT) - "NA" for now
            contactInfo,                       // contact_info (TEXT - CSV format)
            productString,                     // product_title (TEXT)
            price || '130',                    // price (TEXT)
            issueString,                       // issue (TEXT - repair reasons + repair notes)
            serialNumber || '',                // serial_number (TEXT)
            notes || '',                       // notes (TEXT - notes from step 3)
            '[]',                              // process (JSON - empty array)
            'Pending Repair'                   // status (TEXT)
        ]);

        console.log('✅ Insert successful, ID:', insertResult.rows[0]?.id);

        const insertedRow = insertResult.rows[0];
        const dbId = insertedRow.id;
        
        // If no Zendesk ticket, update ticket_number with DB ID
        let finalRSNumber = zendeskTicketNumber;
        if (!zendeskTicketNumber) {
            await pool.query(`
                UPDATE repair_service 
                SET ticket_number = $1 
                WHERE id = $2
            `, [`RS-${String(dbId).padStart(4, '0')}`, dbId]);
            finalRSNumber = `RS-${String(dbId).padStart(4, '0')}`;
        }

        // Step 3: Sync to Google Sheets RS tab
        try {
            await fetch(`${req.nextUrl.origin}/api/google-sheets/append`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sheetId: '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE',
                    tabName: 'RS',
                    values: [[
                        formattedDateTime, // Date/Time
                        finalRSNumber, // RS #
                        contactInfo, // Contact Info
                        productString, // Product Title
                        price || '130', // Price
                        issueString, // Issue (repair reasons)
                        serialNumber || '', // Serial #
                        '', // OOS what we need (parts)
                        'Pending Repair' // Status
                    ]]
                })
            });
        } catch (error) {
            console.error('Failed to sync to Google Sheets:', error);
            // Continue even if sheets sync fails
        }

        // Return success with receipt data
        return NextResponse.json({
            success: true,
            rsNumber: finalRSNumber,
            id: dbId,
            receiptData: {
                rsNumber: finalRSNumber,
                dropOffDate: formattedDateTime,
                customer: {
                    name: customer.name,
                    phone: customer.phone,
                    email: customer.email
                },
                product: productString,
                serialNumber: serialNumber || 'Not provided',
                price: price || '130',
                repairReasons: repairReasons,
                repairNotes: repairNotes || '',
                notes: notes || '',
                status: 'Pending Repair'
            }
        });

    } catch (error: any) {
        console.error('Error submitting repair form:', error);
        return NextResponse.json({ 
            error: 'Failed to submit repair form', 
            details: error.message 
        }, { status: 500 });
    }
}
