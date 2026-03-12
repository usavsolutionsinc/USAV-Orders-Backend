import { NextRequest, NextResponse } from 'next/server';
import { createRepair } from '@/lib/neon/repair-service-queries';
import { createAssignment } from '@/lib/neon/assignments-queries';
import { createZendeskTicket } from '@/lib/zendesk';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishRepairChanged } from '@/lib/realtime/publish';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { customer, product, repairReasons, repairNotes, serialNumber, price, notes, assignedTechId } = body;
        const normalizedProductTitle = String(product?.model || '').trim();
        const normalizedReasons = Array.isArray(repairReasons)
            ? repairReasons.map((reason: unknown) => String(reason || '').trim()).filter(Boolean)
            : [];
        const normalizedRepairNotes = String(repairNotes || '').trim();
        const normalizedSerialNumber = String(serialNumber || '').trim();
        const normalizedPrice = String(price || '').trim();
        const normalizedNotes = String(notes || '').trim();
        const techId = assignedTechId ? Number(assignedTechId) : null;

        // Validate required fields (email is optional)
        if (
            !customer?.name ||
            !customer?.phone ||
            !normalizedProductTitle ||
            (!normalizedReasons.length && !normalizedRepairNotes) ||
            !normalizedSerialNumber ||
            !normalizedPrice
        ) {
            const missing = [];
            if (!customer?.name) missing.push('Name');
            if (!customer?.phone) missing.push('Phone');
            if (!normalizedProductTitle) missing.push('Product Title');
            if (!normalizedReasons.length && !normalizedRepairNotes) missing.push('Repair Reason or Notes');
            if (!normalizedSerialNumber) missing.push('Serial #');
            if (!normalizedPrice) missing.push('Price');

            return NextResponse.json({ 
                error: `Missing required fields: ${missing.join(', ')}` 
            }, { status: 400 });
        }

        const isoTimestamp = new Date().toISOString();

        const productString = normalizedProductTitle;

        // Format contact info (email is optional)
        const contactInfo = customer.email 
            ? `${customer.name}, ${customer.phone}, ${customer.email}`
            : `${customer.name}, ${customer.phone}`;

        // Format issue (repair reasons + repair notes from step 2)
        const issueString = normalizedReasons.join(', ') + (normalizedRepairNotes ? `${normalizedReasons.length ? ' - ' : ''}${normalizedRepairNotes}` : '');

        // Step 1: Create Zendesk ticket via GAS Web App
        let zendeskTicketNumber: string | null = null;
        try {
            zendeskTicketNumber = await createZendeskTicket({
                customerName: customer.name,
                customerPhone: customer.phone,
                customerEmail: customer.email || '', // Optional
                productTitle: productString,
                contactInfo: contactInfo,
                issue: issueString,
                serialNumber: normalizedSerialNumber,
                price: normalizedPrice,
                notes: normalizedNotes // Optional notes from step 3
            });
            console.log('Zendesk ticket created:', zendeskTicketNumber ?? 'missing ticket number');
        } catch (error: any) {
            console.error('Failed to create Zendesk ticket:', error);
            // Continue with DB insert even if Zendesk fails
        }

        // Step 2: Insert into repair_service table in NEON DB
        const repairRecord = await createRepair({
            createdAt: isoTimestamp,
            ticketNumber: zendeskTicketNumber,
            contactInfo,
            productTitle: productString,
            price: normalizedPrice,
            issue: issueString,
            serialNumber: normalizedSerialNumber,
            notes: normalizedNotes || null,
        });

        const dbId = repairRecord.id;
        const finalRSNumber = repairRecord.ticket_number;

        // Insert into work_assignments so the repair appears in the Up Next queue
        try {
            await createAssignment({
                entityType: 'REPAIR',
                entityId: dbId,
                workType: 'REPAIR',
                assignedTechId: techId,
                status: 'ASSIGNED',
            });
        } catch (waErr) {
            console.warn('work_assignments insert skipped (constraint or missing):', waErr);
        }

        // Invalidate repair cache so the next GET returns fresh data
        await invalidateCacheTags(['repair-service']);
        await publishRepairChanged({ repairIds: [Number(dbId)], source: 'repair.submit' });

        // Return success with receipt data
        return NextResponse.json({
            success: true,
            rsNumber: finalRSNumber,
            id: dbId,
            receiptData: {
                rsNumber: finalRSNumber,
                dropOffDate: isoTimestamp,
                customer: {
                    name: customer.name,
                    phone: customer.phone,
                    email: customer.email
                },
                product: productString,
                serialNumber: normalizedSerialNumber || 'Not provided',
                price: normalizedPrice,
                repairReasons: normalizedReasons,
                repairNotes: normalizedRepairNotes,
                notes: normalizedNotes,
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
