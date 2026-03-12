import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCarrier } from '@/utils/tracking';
import { formatPSTTimestamp } from '@/lib/timezone';
import { resolveReceivingSchema } from '@/utils/receiving-schema';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { searchPurchaseOrdersByTracking, searchPurchaseReceivesByTracking, getPurchaseOrderById } from '@/lib/zoho';

/**
 * Compute Mon–Fri week range (PST date strings) for a given PST timestamp string
 * such as '2026-03-04T14:30:00'.  Used to target the exact Redis cache key that
 * ReceivingLogs uses when fetching by week.
 */
function getPSTWeekRange(pstTimestamp: string): { startStr: string; endStr: string } {
    const dateKey = pstTimestamp.substring(0, 10); // 'YYYY-MM-DD'
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const dow = date.getDay(); // 0=Sun
    const daysFromMonday = dow === 0 ? 6 : dow - 1;
    const monday = new Date(date);
    monday.setDate(date.getDate() - daysFromMonday);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { startStr: fmt(monday), endStr: fmt(friday) };
}

// POST - Add entry to receiving table
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { trackingNumber, carrier: providedCarrier } = body;

        const conditionGradeAllowed = new Set(['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS']);
        const qaStatusAllowed = new Set(['PENDING', 'PASSED', 'FAILED_DAMAGED', 'FAILED_INCOMPLETE', 'FAILED_FUNCTIONAL', 'HOLD']);
        const dispositionAllowed = new Set(['ACCEPT', 'HOLD', 'RTV', 'SCRAP', 'REWORK']);
        const returnPlatformAllowed = new Set(['AMZ', 'EBAY_DRAGONH', 'EBAY_USAV', 'EBAY_MK', 'FBA', 'WALMART', 'ECWID']);
        const targetChannelAllowed = new Set(['ORDERS', 'FBA']);

        // condition_grade / disposition_code are nullable for Zoho PO-originated entries
        // (per-item state lives in receiving_lines); for standalone bulk scans they default to BRAND_NEW/HOLD.
        const rawConditionGrade = String(body?.conditionGrade || body?.condition_grade || '').trim().toUpperCase();
        const conditionGrade = conditionGradeAllowed.has(rawConditionGrade) ? rawConditionGrade : null;

        const rawQaStatus = String(body?.qaStatus || body?.qa_status || 'PENDING').trim().toUpperCase();
        const qaStatus = qaStatusAllowed.has(rawQaStatus) ? rawQaStatus : 'PENDING';

        const rawDisposition = String(body?.dispositionCode || body?.disposition_code || '').trim().toUpperCase();
        const dispositionCode = dispositionAllowed.has(rawDisposition) ? rawDisposition : null;

        const isReturn = !!body?.isReturn || !!body?.is_return;
        const rawReturnPlatform = String(body?.returnPlatform || body?.return_platform || '').trim().toUpperCase();
        const returnPlatform = isReturn && returnPlatformAllowed.has(rawReturnPlatform) ? rawReturnPlatform : null;
        const returnReason = isReturn ? (String(body?.returnReason || body?.return_reason || '').trim() || null) : null;

        const needsTest = !!body?.needsTest || !!body?.needs_test;
        const assignedTechIdRaw = Number(body?.assignedTechId ?? body?.assigned_tech_id);
        const assignedTechId = needsTest && Number.isFinite(assignedTechIdRaw) && assignedTechIdRaw > 0 ? assignedTechIdRaw : null;

        const rawTargetChannel = String(body?.targetChannel || body?.target_channel || '').trim().toUpperCase();
        const targetChannel = targetChannelAllowed.has(rawTargetChannel) ? rawTargetChannel : null;

        const zohoPurchaseReceiveId = String(body?.zohoPurchaseReceiveId || body?.zoho_purchase_receive_id || '').trim() || null;
        const zohoWarehouseId = String(body?.zohoWarehouseId || body?.zoho_warehouse_id || '').trim() || null;

        if (!trackingNumber) {
            return NextResponse.json({ 
                error: 'trackingNumber is required' 
            }, { status: 400 });
        }

        const detectedCarrier = providedCarrier && providedCarrier !== 'Unknown' 
            ? providedCarrier 
            : getCarrier(trackingNumber);

        // Always stamp on the server in PST/PDT to avoid client timezone drift.
        const now = formatPSTTimestamp();
        
        const { dateColumn } = await resolveReceivingSchema();
        const columnsRes = await pool.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_name = 'receiving'`
        );
        const availableColumns = new Set<string>(columnsRes.rows.map((r: any) => String(r.column_name)));
        const valuesByColumn: Record<string, any> = {
            [dateColumn]: now,
            receiving_tracking_number: trackingNumber,
            carrier: detectedCarrier,
            received_at: now,
            condition_grade: conditionGrade,
            qa_status: qaStatus,
            disposition_code: dispositionCode,
            is_return: isReturn,
            return_platform: returnPlatform,
            return_reason: returnReason,
            needs_test: needsTest,
            assigned_tech_id: assignedTechId,
            target_channel: targetChannel,
            zoho_purchase_receive_id: zohoPurchaseReceiveId,
            zoho_warehouse_id: zohoWarehouseId,
            updated_at: now,
        };

        const insertColumns: string[] = [];
        const insertValues: any[] = [];
        Object.entries(valuesByColumn).forEach(([column, value]) => {
            if (!availableColumns.has(column)) return;
            insertColumns.push(column);
            insertValues.push(value);
        });

        if (insertColumns.length === 0) {
            throw new Error('No compatible receiving columns found for insert');
        }

        const valuePlaceholders = insertColumns.map((_, i) => `$${i + 1}`).join(', ');
        const inserted = await pool.query(
            `INSERT INTO receiving (${insertColumns.join(', ')})
             VALUES (${valuePlaceholders})
             RETURNING id`,
            insertValues
        );

        const newRecord = {
            id: String(inserted.rows[0].id),
            timestamp: now,
            tracking: trackingNumber,
            status: detectedCarrier,
            count: 1,
            condition_grade: conditionGrade,
            qa_status: qaStatus,
            disposition_code: dispositionCode,
            is_return: isReturn,
            return_platform: returnPlatform,
            needs_test: needsTest,
            assigned_tech_id: assignedTechId,
            target_channel: targetChannel,
            zoho_purchase_receive_id: zohoPurchaseReceiveId,
            zoho_warehouse_id: zohoWarehouseId,
        };

        // ── Auto-match Zoho PO lines to this receiving row ──────────────────
        // 1. Try local unmatched receiving_lines first (fastest, no Zoho API call).
        // 2. If none found, search Zoho by tracking number and sync any matching POs.
        let zohoMatchSummary: {
            strategy: string;
            matched_lines: number;
            zoho_po_ids: string[];
        } | null = null;

        try {
            const newReceivingId = Number(inserted.rows[0].id);

            // 1a. Check if local receiving_lines already exist for this tracking number
            //     (pre-synced via Zoho PO sync). Try matching by purchase receive tracking.
            const localUnmatched = await pool.query<{ id: number; zoho_purchaseorder_id: string | null }>(
                `SELECT id, zoho_purchaseorder_id
                 FROM receiving_lines
                 WHERE receiving_id IS NULL
                   AND (
                     zoho_purchase_receive_id = $1
                     OR notes ILIKE $2
                   )
                 LIMIT 50`,
                [trackingNumber, `%${trackingNumber}%`]
            );

            if (localUnmatched.rows.length > 0) {
                const lineIds = localUnmatched.rows.map((r) => r.id);
                await pool.query(
                    `UPDATE receiving_lines
                     SET receiving_id    = $1,
                         workflow_status = 'MATCHED'::inbound_workflow_status_enum,
                         updated_at      = NOW()
                     WHERE id = ANY($2::int[])`,
                    [newReceivingId, lineIds]
                );
                zohoMatchSummary = {
                    strategy: 'local_lines',
                    matched_lines: lineIds.length,
                    zoho_po_ids: Array.from(new Set(localUnmatched.rows.map((r) => r.zoho_purchaseorder_id).filter(Boolean))) as string[],
                };
            } else {
                // 1b. Search Zoho Purchase Receives by tracking number
                const zohoReceives = await searchPurchaseReceivesByTracking(trackingNumber).catch(() => []);
                let matchedPoIds: string[] = [];

                if (zohoReceives.length > 0) {
                    // Mark this receiving row with the first matching purchase receive ID
                    const firstReceive = zohoReceives[0];
                    const prId = String(firstReceive.purchase_receive_id || '');
                    if (prId) {
                        await pool.query(
                            `UPDATE receiving
                             SET zoho_purchase_receive_id = $1, updated_at = NOW()
                             WHERE id = $2 AND zoho_purchase_receive_id IS NULL`,
                            [prId, newReceivingId]
                        );
                        newRecord.zoho_purchase_receive_id = prId;
                    }
                    // Sync lines from each purchase receive's parent PO
                    for (const receive of zohoReceives.slice(0, 3)) {
                        const poId = String(receive.purchaseorder_id || '');
                        if (!poId || matchedPoIds.includes(poId)) continue;
                        matchedPoIds.push(poId);

                        const existingLines = await pool.query<{ id: number }>(
                            `SELECT id FROM receiving_lines
                             WHERE zoho_purchaseorder_id = $1 AND receiving_id IS NULL
                             LIMIT 1`,
                            [poId]
                        );

                        if (existingLines.rows.length > 0) {
                            // Lines already synced — just link them
                            const linked = await pool.query<{ id: number }>(
                                `UPDATE receiving_lines
                                 SET receiving_id    = $1,
                                     workflow_status = 'MATCHED'::inbound_workflow_status_enum,
                                     updated_at      = NOW()
                                 WHERE zoho_purchaseorder_id = $2
                                   AND receiving_id IS NULL
                                 RETURNING id`,
                                [newReceivingId, poId]
                            );
                            const lineCount = linked.rowCount ?? 0;
                            if (zohoMatchSummary) {
                                zohoMatchSummary.matched_lines += lineCount;
                            } else {
                                zohoMatchSummary = { strategy: 'local_po_lines', matched_lines: lineCount, zoho_po_ids: [poId] };
                            }
                        } else {
                            // Fetch PO detail from Zoho and insert lines now
                            try {
                                const poDetail = await getPurchaseOrderById(poId);
                                const po = (poDetail as any)?.purchaseorder;
                                const lineItems = Array.isArray(po?.line_items) ? po.line_items : [];
                                let insertedCount = 0;
                                for (const line of lineItems) {
                                    const zohoItemId = String(line?.item_id || '').trim();
                                    const zohoLineItemId = String(line?.line_item_id || line?.id || '').trim();
                                    const qtyExpected = Math.floor(Math.max(0, Number(line?.quantity ?? 0)));
                                    if (!zohoItemId || qtyExpected <= 0) continue;

                                    await pool.query(
                                        `INSERT INTO receiving_lines (
                                           receiving_id, zoho_item_id, zoho_line_item_id,
                                           zoho_purchaseorder_id, item_name, sku,
                                           quantity_received, quantity_expected,
                                           qa_status, disposition_code, condition_grade,
                                           disposition_audit, workflow_status
                                         )
                                         VALUES ($1,$2,$3,$4,$5,$6,0,$7,
                                                 'PENDING','HOLD','BRAND_NEW','[]'::jsonb,
                                                 'MATCHED'::inbound_workflow_status_enum)
                                         ON CONFLICT DO NOTHING`,
                                        [
                                            newReceivingId,
                                            zohoItemId,
                                            zohoLineItemId || null,
                                            poId,
                                            String(line?.name || line?.item_name || '').trim() || null,
                                            String(line?.sku || '').trim() || null,
                                            qtyExpected,
                                        ]
                                    );
                                    insertedCount++;
                                }
                                if (insertedCount > 0) {
                                    if (zohoMatchSummary) {
                                        zohoMatchSummary.matched_lines += insertedCount;
                                        zohoMatchSummary.zoho_po_ids.push(poId);
                                    } else {
                                        zohoMatchSummary = { strategy: 'zoho_purchase_receive', matched_lines: insertedCount, zoho_po_ids: [poId] };
                                    }
                                }
                            } catch {
                                // Zoho PO fetch failed — non-fatal
                            }
                        }
                    }
                }

                // 1c. If still no match, search Zoho POs directly by tracking as reference
                if (!zohoMatchSummary) {
                    const zohoPOs = await searchPurchaseOrdersByTracking(trackingNumber).catch(() => []);
                    for (const po of zohoPOs.slice(0, 3)) {
                        const poId = po.purchaseorder_id;
                        if (!poId || matchedPoIds.includes(poId)) continue;
                        matchedPoIds.push(poId);

                        // Try to fetch full PO detail (may already have line_items)
                        const lineItems = Array.isArray(po.line_items) ? po.line_items : [];
                        const fullLineItems = lineItems.length > 0
                            ? lineItems
                            : await getPurchaseOrderById(poId)
                                .then((d) => (d as any)?.purchaseorder?.line_items ?? [])
                                .catch(() => []);

                        let insertedCount = 0;
                        for (const line of fullLineItems) {
                            const zohoItemId = String(line?.item_id || '').trim();
                            const zohoLineItemId = String(line?.line_item_id || line?.id || '').trim();
                            const qtyExpected = Math.floor(Math.max(0, Number(line?.quantity ?? 0)));
                            if (!zohoItemId || qtyExpected <= 0) continue;

                            await pool.query(
                                `INSERT INTO receiving_lines (
                                   receiving_id, zoho_item_id, zoho_line_item_id,
                                   zoho_purchaseorder_id, item_name, sku,
                                   quantity_received, quantity_expected,
                                   qa_status, disposition_code, condition_grade,
                                   disposition_audit, workflow_status
                                 )
                                 VALUES ($1,$2,$3,$4,$5,$6,0,$7,
                                         'PENDING','HOLD','BRAND_NEW','[]'::jsonb,
                                         'MATCHED'::inbound_workflow_status_enum)
                                 ON CONFLICT DO NOTHING`,
                                [
                                    newReceivingId,
                                    zohoItemId,
                                    zohoLineItemId || null,
                                    poId,
                                    String(line?.name || line?.item_name || '').trim() || null,
                                    String(line?.sku || '').trim() || null,
                                    qtyExpected,
                                ]
                            );
                            insertedCount++;
                        }
                        if (insertedCount > 0) {
                            if (zohoMatchSummary) {
                                zohoMatchSummary.matched_lines += insertedCount;
                                zohoMatchSummary.zoho_po_ids.push(poId);
                            } else {
                                zohoMatchSummary = { strategy: 'zoho_po_search', matched_lines: insertedCount, zoho_po_ids: [poId] };
                            }
                        }
                    }
                }
            }
        } catch (matchErr) {
            // Zoho auto-match is best-effort — don't fail the receiving entry
            console.warn('Zoho auto-match warning:', matchErr instanceof Error ? matchErr.message : matchErr);
        }

        if (needsTest && assignedTechId) {
            const assignmentTableRes = await pool.query(
                `SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_name = 'work_assignments'
                ) AS exists`
            );
            if (assignmentTableRes.rows[0]?.exists) {
                await pool.query(
                    `INSERT INTO work_assignments (
                        entity_type,
                        entity_id,
                        work_type,
                        assigned_tech_id,
                        status,
                        priority,
                        notes
                     )
                     VALUES ('RECEIVING', $1, 'TEST', $2, 'ASSIGNED', 100, $3)
                     ON CONFLICT DO NOTHING`,
                    [
                        Number(inserted.rows[0].id),
                        assignedTechId,
                        `Auto-created from receiving entry ${trackingNumber}`,
                    ]
                );
            }
        }

        // Surgical Redis cache update: prepend the single new record to the
        // current week's cached array instead of invalidating and re-querying.
        // If that week isn't cached yet the next regular fetch will populate it.
        const weekRange = getPSTWeekRange(now);
        const weekCacheKey = createCacheLookupKey({
            limit: 500,
            offset: 0,
            weekStart: weekRange.startStr,
            weekEnd: weekRange.endStr,
        });
        const existing = await getCachedJson<any[]>('api:receiving-logs', weekCacheKey);
        if (Array.isArray(existing)) {
            await setCachedJson(
                'api:receiving-logs',
                weekCacheKey,
                [newRecord, ...existing].slice(0, 500),
                120,          // current-week TTL: 2 min
                ['receiving-logs'],
            );
        }

        await publishReceivingLogChanged({
            action: 'insert',
            rowId: newRecord.id,
            row: newRecord,
            source: 'receiving-entry',
        });

        return NextResponse.json({
            success: true,
            record: newRecord,
            ...(zohoMatchSummary ? { zoho_match: zohoMatchSummary } : {}),
        }, { status: 201 });
    } catch (error) {
        console.error('Error adding receiving entry:', error);
        return NextResponse.json({ 
            error: 'Failed to add receiving entry',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

// GET - Fetch all receiving logs
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const cacheLookup = createCacheLookupKey({ limit, offset });

    try {
        const cached = await getCachedJson<any[]>('api:receiving-entry', cacheLookup);
        if (cached) {
            return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
        }

        const { dateColumn, hasQuantity } = await resolveReceivingSchema();
        const countExpr = hasQuantity ? "COALESCE(quantity, '1')" : "'1'";
        const result = await pool.query(
            `SELECT
                id,
                (${dateColumn} AT TIME ZONE 'America/Los_Angeles')::text AS timestamp,
                receiving_tracking_number AS tracking,
                carrier,
                ${countExpr} AS quantity
             FROM receiving
             WHERE receiving_tracking_number IS NOT NULL AND receiving_tracking_number != ''
             ORDER BY id DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
            
        await setCachedJson('api:receiving-entry', cacheLookup, result.rows, 30, ['receiving-logs']);
        return NextResponse.json(result.rows, { headers: { 'x-cache': 'MISS' } });
    } catch (error) {
        console.error('Error fetching receiving logs:', error);
        return NextResponse.json({ 
            error: 'Failed to fetch receiving logs',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
