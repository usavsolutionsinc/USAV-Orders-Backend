import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createZendeskTicket } from '@/lib/zendesk';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { customer, product, repairReasons, additionalNotes, serialNumber } = body;

        // Validate required fields
        if (!customer?.name || !customer?.phone || !product?.type || !product?.model || !repairReasons?.length) {
            return NextResponse.json({ 
                error: 'Missing required fields' 
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
        const contactInfo = `${customer.name}, ${customer.phone}${customer.email ? `, ${customer.email}` : ''}`;

        // Format repair reasons
        const repairReasonsString = repairReasons.join(', ') + (additionalNotes ? ` - ${additionalNotes}` : '');

        // Step 1: Create Zendesk ticket via email
        let zendeskTicketNumber: string | null = null;
        try {
            zendeskTicketNumber = await createZendeskTicket({
                customerName: customer.name,
                customerPhone: customer.phone,
                customerEmail: customer.email,
                product: productString,
                repairReasons,
                additionalNotes,
                serialNumber
            });
        } catch (error) {
            console.error('Failed to create Zendesk ticket:', error);
            // Continue even if Zendesk fails - will use DB ID
        }

        // Step 2: Insert into RS table in NEON DB
        const insertResult = await pool.query(`
            INSERT INTO rs (col_2, col_3, col_4, col_5, col_6, col_7, col_8, col_9)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING col_1 as id, col_3 as rs_number
        `, [
            formattedDateTime, // col_2: date/time
            zendeskTicketNumber || '', // col_3: RS # (will use DB ID if empty)
            contactInfo, // col_4: contact
            productString, // col_5: product(s)
            repairReasonsString, // col_6: reason for repair
            serialNumber || '', // col_7: serial #
            '', // col_8: parts needed (empty initially)
            'Pending' // col_9: status
        ]);

        const insertedRow = insertResult.rows[0];
        const dbId = insertedRow.id;
        
        // If no Zendesk ticket, update col_3 with DB ID
        let finalRSNumber = zendeskTicketNumber;
        if (!zendeskTicketNumber) {
            await pool.query(`
                UPDATE rs 
                SET col_3 = $1 
                WHERE col_1 = $2
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
                        '', // col_1 (auto-filled by sheets)
                        formattedDateTime, // Date/Time
                        finalRSNumber, // RS #
                        contactInfo, // Contact
                        productString, // Product(s) Title
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
