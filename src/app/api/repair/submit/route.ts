import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createZendeskTicket } from '@/lib/zendesk';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { customer, product, repairReasons, additionalNotes, serialNumber, price } = body;

        // Validate required fields for both DB and Zendesk
        if (!customer?.name || !customer?.phone || !customer?.email || !product?.type || !product?.model || !repairReasons?.length || !serialNumber || !price) {
            const missing = [];
            if (!customer?.name) missing.push('Name');
            if (!customer?.phone) missing.push('Phone');
            if (!customer?.email) missing.push('Email');
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

        // Format contact info
        const contactInfo = `${customer.name}, ${customer.phone}, ${customer.email}`;

        // Format repair reasons
        const repairReasonsString = repairReasons.join(', ') + (additionalNotes ? ` - ${additionalNotes}` : '');

        // Step 1: Create Zendesk ticket via GAS Web App
        let zendeskTicketNumber: string | null = null;
        try {
            zendeskTicketNumber = await createZendeskTicket({
                customerName: customer.name,
                customerPhone: customer.phone,
                customerEmail: customer.email,
                product: productString,
                repairReasons,
                additionalNotes,
                serialNumber,
                price
            });
        } catch (error: any) {
            console.error('Failed to create Zendesk ticket:', error);
            // Continue with DB insert even if Zendesk fails, but keep track of error
            // result.error will be returned if critical, but user wants to fix the env var
        }

        // Step 2: Insert into repair_service table in NEON DB
        // Fix: date_time, process, and status_history are JSON columns in the DB.
        // We must provide valid JSON strings.
        const insertResult = await pool.query(`
            INSERT INTO repair_service (date_time, ticket_number, name, contact, product_title, price, issue, serial_number, process, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, ticket_number
        `, [
            JSON.stringify(formattedDateTime), // Store as JSON string
            zendeskTicketNumber || '',
            customer.name,
            contactInfo,
            productString,
            price || '130',
            repairReasonsString,
            serialNumber || '',
            '[]', // process (empty JSON array)
            'Pending'
        ]);

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
                        contactInfo, // Contact
                        productString, // Product(s) Title
                        price || '130', // Price
                        repairReasonsString, // Reason for repair
                        serialNumber || '', // Serial #
                        '', // OOS what we need (parts)
                        'Pending' // Status
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
                additionalNotes: additionalNotes || '',
                status: 'Pending'
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
