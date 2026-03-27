import { NextRequest, NextResponse } from 'next/server';
import { createRepair, updateRepairField } from '@/lib/neon/repair-service-queries';
import { createAssignment } from '@/lib/neon/assignments-queries';
import { addBusinessDays, createZendeskTicket } from '@/lib/zendesk';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishRepairChanged } from '@/lib/realtime/publish';
import { formatPSTTimestamp } from '@/utils/date';
import { findOrCreateRepairCustomer, linkCustomerToRepair } from '@/lib/neon/customer-queries';
import { put } from '@vercel/blob';
import pool from '@/lib/db';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { customer, product, repairReasons, repairNotes, serialNumber, price, notes, assignedTechId, signatureDataUrl, signatureStrokes } = body;
        const normalizedProductTitle = String(product?.model || '').trim();
        const normalizedReasons = Array.isArray(repairReasons)
            ? repairReasons.map((reason: unknown) => String(reason || '').trim()).filter(Boolean)
            : [];
        const normalizedRepairNotes = String(repairNotes || '').trim();
        const normalizedSerialNumber = String(serialNumber || '').trim();
        const normalizedPrice = String(price || '').trim();
        const normalizedNotes = String(notes || '').trim();
        const normalizedSourceSku = String(product?.sourceSku || '').trim();
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

        const postedAt = formatPSTTimestamp();

        // Calculate the 5-business-day repair deadline (same value sent to Zendesk).
        const deadlineAt = addBusinessDays(new Date(), 5).toISOString().slice(0, 10);

        const productString = normalizedProductTitle;

        // Format contact info (email is optional) — kept for backward compatibility
        const contactInfo = customer.email
            ? `${customer.name}, ${customer.phone}, ${customer.email}`
            : `${customer.name}, ${customer.phone}`;

        // Format issue (repair reasons + repair notes from step 2)
        const issueString = normalizedReasons.join(', ') + (normalizedRepairNotes ? `${normalizedReasons.length ? ' - ' : ''}${normalizedRepairNotes}` : '');

        // Step 1: Find or create customer record
        const customerRecord = await findOrCreateRepairCustomer({
            name: customer.name,
            phone: customer.phone,
            email: customer.email || undefined,
        });

        // Step 2: Create repair row with customer_id FK
        const repairRecord = await createRepair({
            createdAt: postedAt,
            ticketNumber: null,
            contactInfo,
            productTitle: productString,
            price: normalizedPrice,
            issue: issueString,
            serialNumber: normalizedSerialNumber,
            notes: normalizedNotes || null,
            sourceSystem: normalizedSourceSku ? 'ecwid' : null,
            sourceSku: normalizedSourceSku || null,
            customerId: customerRecord.id,
        });

        const dbId = repairRecord.id;
        const finalRSNumber = repairRecord.ticket_number;

        // Link customer entity_id to this repair (if newly created)
        await linkCustomerToRepair(customerRecord.id, dbId);

        // Step 3: Upload signature to Vercel Blob + create document record
        // Primary: JSON stroke data stored in document_data (always saved)
        // Secondary: PNG uploaded to blob for quick viewing
        let signatureUrl: string | null = null;
        let signatureWarning: string | null = null;
        let documentId: number | null = null;

        const hasSignature = signatureDataUrl && typeof signatureDataUrl === 'string' && signatureDataUrl.startsWith('data:image/');

        if (hasSignature) {
            // Upload PNG to Vercel Blob
            try {
                const base64Data = signatureDataUrl.split(',')[1];
                const buffer = Buffer.from(base64Data, 'base64');
                const blobPath = `repair_signatures/${finalRSNumber}_${Date.now()}.png`;

                const blob = await put(blobPath, buffer, {
                    access: 'public',
                    contentType: 'image/png',
                });
                signatureUrl = blob.url;
            } catch (sigError) {
                console.error('Failed to upload signature PNG to blob:', sigError);
                signatureWarning = 'Signature image upload failed — stroke data saved as backup';
            }
        }

        // Always create document record if we have signature data (strokes or PNG)
        if (hasSignature || (Array.isArray(signatureStrokes) && signatureStrokes.length > 0)) {
            try {
                const docResult = await pool.query(
                    `INSERT INTO documents (
                        entity_type, entity_id, document_type, signature_url, signer_name, signed_at, document_data
                    ) VALUES ('REPAIR', $1, 'intake_agreement', $2, $3, NOW(), $4)
                    RETURNING id`,
                    [
                        dbId,
                        signatureUrl,
                        customer.name,
                        JSON.stringify({
                            ticketNumber: finalRSNumber,
                            product: productString,
                            serialNumber: normalizedSerialNumber,
                            issue: issueString,
                            price: normalizedPrice,
                            customerName: customer.name,
                            customerPhone: customer.phone,
                            customerEmail: customer.email || null,
                            signatureStrokes: Array.isArray(signatureStrokes) ? signatureStrokes : null,
                            terms: 'Your Bose product has been received into our repair center. Under normal circumstances it will be repaired within the next 3-10 working days. There is a 30 day Warranty on all our repair services.',
                            signedAt: new Date().toISOString(),
                        }),
                    ],
                );
                documentId = docResult.rows[0]?.id ?? null;
            } catch (docError) {
                console.error('Failed to create document record:', docError);
                signatureWarning = 'Failed to save signed document';
            }
        }

        // Step 4: Create Zendesk ticket via GAS Web App
        let zendeskTicketNumber: string | null = null;
        try {
            zendeskTicketNumber = await createZendeskTicket({
                repairServiceId: dbId,
                repairServiceNumber: finalRSNumber,
                customerName: customer.name,
                customerPhone: customer.phone,
                customerEmail: customer.email || '',
                productTitle: productString,
                contactInfo: contactInfo,
                issue: issueString,
                serialNumber: normalizedSerialNumber,
                price: normalizedPrice,
                notes: normalizedNotes
            });
            console.log('Zendesk ticket created:', zendeskTicketNumber ?? 'missing ticket number');
            if (zendeskTicketNumber) {
                await updateRepairField(dbId, 'ticket_number', zendeskTicketNumber);
            }
        } catch (error: any) {
            console.error('Failed to create Zendesk ticket:', error);
        }

        // Step 5: Insert work_assignment
        try {
            await createAssignment({
                entityType: 'REPAIR',
                entityId: dbId,
                workType: 'REPAIR',
                assignedTechId: techId,
                status: 'ASSIGNED',
                deadlineAt,
            });
        } catch (waErr) {
            console.warn('work_assignments insert skipped (constraint or missing):', waErr);
        }

        // Invalidate repair cache
        await invalidateCacheTags(['repair-service']);
        await publishRepairChanged({ repairIds: [Number(dbId)], source: 'repair.submit' });

        return NextResponse.json({
            success: true,
            rsNumber: finalRSNumber,
            id: dbId,
            zendeskTicketNumber,
            customerId: customerRecord.id,
            documentId,
            signatureUrl,
            signatureWarning,
        });

    } catch (error: any) {
        console.error('Error submitting repair form:', error);
        return NextResponse.json({
            error: 'Failed to submit repair form',
            details: error.message
        }, { status: 500 });
    }
}
