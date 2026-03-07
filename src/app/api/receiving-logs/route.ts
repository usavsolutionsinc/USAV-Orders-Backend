import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { resolveReceivingSchema } from '@/utils/receiving-schema';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');
        const weekStart = searchParams.get('weekStart') || '';
        const weekEnd = searchParams.get('weekEnd') || '';
        const cacheLookup = createCacheLookupKey({ limit, offset, weekStart, weekEnd });

        const today = new Date().toISOString().substring(0, 10);
        const cacheTTL = weekEnd && weekEnd < today ? 86400 : 30;
        const CACHE_HEADERS = { 'Cache-Control': `private, max-age=${cacheTTL}, stale-while-revalidate=15` };

        const cached = await getCachedJson<any[]>('api:receiving-logs', cacheLookup);
        if (cached) {
            return NextResponse.json(cached, { headers: { 'x-cache': 'HIT', ...CACHE_HEADERS } });
        }

        const tableCheck = await pool.query(
            `SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'receiving'
            ) AS exists`
        );
        if (!tableCheck.rows[0]?.exists) {
            return NextResponse.json([], { headers: { 'x-cache': 'MISS', ...CACHE_HEADERS } });
        }

        const { dateColumn, hasQuantity } = await resolveReceivingSchema();
        const countExpr = hasQuantity ? "COALESCE(quantity, '1')" : "'1'";
        const columnsRes = await pool.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_name = 'receiving'`
        );
        const availableColumns = new Set<string>(columnsRes.rows.map((r: any) => String(r.column_name)));
        const hasColumn = (name: string) => availableColumns.has(name);

        const selectFields: string[] = [
            'id',
            `${dateColumn} AS timestamp`,
            'receiving_tracking_number AS tracking',
            'carrier AS status',
            `${countExpr} AS count`,
            hasColumn('qa_status') ? 'qa_status' : "NULL::text AS qa_status",
            hasColumn('disposition_code') ? 'disposition_code' : "NULL::text AS disposition_code",
            hasColumn('condition_grade') ? 'condition_grade' : "NULL::text AS condition_grade",
            hasColumn('is_return') ? 'is_return' : 'FALSE AS is_return',
            hasColumn('return_platform') ? 'return_platform' : "NULL::text AS return_platform",
            hasColumn('return_reason') ? 'return_reason' : "NULL::text AS return_reason",
            hasColumn('needs_test') ? 'needs_test' : 'FALSE AS needs_test',
            hasColumn('assigned_tech_id') ? 'assigned_tech_id' : 'NULL::int AS assigned_tech_id',
            hasColumn('target_channel') ? 'target_channel' : "NULL::text AS target_channel",
            hasColumn('received_at') ? 'received_at' : 'NULL::text AS received_at',
            hasColumn('received_by') ? 'received_by' : 'NULL::int AS received_by',
            hasColumn('unboxed_at') ? 'unboxed_at' : 'NULL::text AS unboxed_at',
            hasColumn('unboxed_by') ? 'unboxed_by' : 'NULL::int AS unboxed_by',
            hasColumn('zoho_purchase_receive_id') ? 'zoho_purchase_receive_id' : "NULL::text AS zoho_purchase_receive_id",
            hasColumn('zoho_warehouse_id') ? 'zoho_warehouse_id' : "NULL::text AS zoho_warehouse_id",
        ];

        // Build optional week pre-filter (UTC ±1 day buffer for PST boundary records).
        const queryParams: any[] = [];
        let weekClause = '';
        if (weekStart && weekEnd) {
            queryParams.push(weekStart, weekEnd);
            // Cast dateColumn to timestamptz so the date-arithmetic operators resolve
            // regardless of whether the column is stored as text or timestamp.
            weekClause = `AND ${dateColumn}::timestamptz >= ($1::date - interval '1 day')
              AND ${dateColumn}::timestamptz <  ($2::date + interval '2 days')`;
        }
        queryParams.push(limit, offset);
        const limitIdx = queryParams.length - 1;
        const offsetIdx = queryParams.length;

        const logs = await pool.query(`
            SELECT ${selectFields.join(', ')}
            FROM receiving
            WHERE receiving_tracking_number IS NOT NULL AND receiving_tracking_number != ''
              ${weekClause}
            ORDER BY id DESC
            LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `, queryParams);

        const formattedLogs = logs.rows.map((log: any) => ({
            id: String(log.id),
            timestamp: log.timestamp || '',
            tracking: log.tracking || '',
            status: log.status || '',
            count: parseInt(String(log.count || '1'), 10) || 1,
            qa_status: log.qa_status || null,
            disposition_code: log.disposition_code || null,
            condition_grade: log.condition_grade || null,
            is_return: !!log.is_return,
            return_platform: log.return_platform || null,
            return_reason: log.return_reason || null,
            needs_test: !!log.needs_test,
            assigned_tech_id: log.assigned_tech_id ? Number(log.assigned_tech_id) : null,
            target_channel: log.target_channel || null,
            received_at: log.received_at || null,
            received_by: log.received_by ? Number(log.received_by) : null,
            unboxed_at: log.unboxed_at || null,
            unboxed_by: log.unboxed_by ? Number(log.unboxed_by) : null,
            zoho_purchase_receive_id: log.zoho_purchase_receive_id || null,
            zoho_warehouse_id: log.zoho_warehouse_id || null,
        }));

        await setCachedJson('api:receiving-logs', cacheLookup, formattedLogs, cacheTTL, ['receiving-logs']);
        return NextResponse.json(formattedLogs, { headers: { 'x-cache': 'MISS', ...CACHE_HEADERS } });
    } catch (error: any) {
        console.error('Error fetching receiving logs:', error);
        return NextResponse.json(
            { error: 'Failed to fetch receiving logs', details: error.message },
            { status: 500 }
        );
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const idRaw = searchParams.get('id');
        const id = Number(idRaw);

        if (!idRaw || !Number.isFinite(id) || id <= 0) {
            return NextResponse.json(
                { error: 'Valid id is required' },
                { status: 400 }
            );
        }

        const result = await pool.query(
            `DELETE FROM receiving WHERE id = $1 RETURNING id`,
            [id]
        );

        if (result.rowCount === 0) {
            return NextResponse.json(
                { error: 'Receiving log not found' },
                { status: 404 }
            );
        }

        await invalidateCacheTags(['receiving-logs']);
        return NextResponse.json({ success: true, id });
    } catch (error: any) {
        console.error('Error deleting receiving log:', error);
        return NextResponse.json(
            { error: 'Failed to delete receiving log', details: error.message },
            { status: 500 }
        );
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const id = Number(body?.id);
        const tracking = String(body?.tracking ?? '').trim();
        const status = String(body?.status ?? '').trim();
        const countRaw = body?.count;
        const qaStatusRaw = String(body?.qa_status ?? body?.qaStatus ?? '').trim().toUpperCase();
        const dispositionCodeRaw = String(body?.disposition_code ?? body?.dispositionCode ?? '').trim().toUpperCase();
        const conditionGradeRaw = String(body?.condition_grade ?? body?.conditionGrade ?? '').trim().toUpperCase();
        const isReturnRaw = body?.is_return ?? body?.isReturn;
        const returnPlatformRaw = String(body?.return_platform ?? body?.returnPlatform ?? '').trim().toUpperCase();
        const returnReasonRaw = body?.return_reason ?? body?.returnReason;
        const needsTestRaw = body?.needs_test ?? body?.needsTest;
        const assignedTechIdRaw = body?.assigned_tech_id ?? body?.assignedTechId;
        const targetChannelRaw = String(body?.target_channel ?? body?.targetChannel ?? '').trim().toUpperCase();
        const unboxedByRaw = body?.unboxed_by ?? body?.unboxedBy;
        const unboxedAtRaw = body?.unboxed_at ?? body?.unboxedAt;

        const qaStatusAllowed = new Set(['PENDING', 'PASSED', 'FAILED_DAMAGED', 'FAILED_INCOMPLETE', 'FAILED_FUNCTIONAL', 'HOLD']);
        const dispositionAllowed = new Set(['ACCEPT', 'HOLD', 'RTV', 'SCRAP', 'REWORK']);
        const conditionAllowed = new Set(['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS']);
        const returnPlatformAllowed = new Set(['AMZ', 'EBAY_DRAGONH', 'EBAY_USAV', 'EBAY_MK', 'FBA', 'WALMART', 'ECWID']);
        const targetChannelAllowed = new Set(['ORDERS', 'FBA']);

        const hasReturnPlatformField = Object.prototype.hasOwnProperty.call(body ?? {}, 'return_platform') || Object.prototype.hasOwnProperty.call(body ?? {}, 'returnPlatform');
        const hasTargetChannelField = Object.prototype.hasOwnProperty.call(body ?? {}, 'target_channel') || Object.prototype.hasOwnProperty.call(body ?? {}, 'targetChannel');

        if (!Number.isFinite(id) || id <= 0) {
            return NextResponse.json({ error: 'Valid id is required' }, { status: 400 });
        }

        const { hasQuantity } = await resolveReceivingSchema();
        const columnsRes = await pool.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_name = 'receiving'`
        );
        const availableColumns = new Set<string>(columnsRes.rows.map((r: any) => String(r.column_name)));

        const updates: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (tracking) {
            updates.push(`receiving_tracking_number = $${idx++}`);
            values.push(tracking);
        }
        if (status) {
            updates.push(`carrier = $${idx++}`);
            values.push(status || 'Unknown');
        }

        if (hasQuantity && countRaw !== undefined && countRaw !== null && String(countRaw).trim() !== '') {
            updates.push(`quantity = $${idx++}`);
            values.push(String(countRaw).trim());
        }

        if (availableColumns.has('qa_status') && qaStatusAllowed.has(qaStatusRaw)) {
            updates.push(`qa_status = $${idx++}`);
            values.push(qaStatusRaw);
        }
        // disposition_code and condition_grade are now nullable — allow explicit null clear
        if (availableColumns.has('disposition_code') && Object.prototype.hasOwnProperty.call(body ?? {}, 'disposition_code') || Object.prototype.hasOwnProperty.call(body ?? {}, 'dispositionCode')) {
            if (!dispositionCodeRaw) {
                updates.push(`disposition_code = NULL`);
            } else if (dispositionAllowed.has(dispositionCodeRaw)) {
                updates.push(`disposition_code = $${idx++}`);
                values.push(dispositionCodeRaw);
            }
        }
        if (availableColumns.has('condition_grade') && Object.prototype.hasOwnProperty.call(body ?? {}, 'condition_grade') || Object.prototype.hasOwnProperty.call(body ?? {}, 'conditionGrade')) {
            if (!conditionGradeRaw) {
                updates.push(`condition_grade = NULL`);
            } else if (conditionAllowed.has(conditionGradeRaw)) {
                updates.push(`condition_grade = $${idx++}`);
                values.push(conditionGradeRaw);
            }
        }
        if (availableColumns.has('is_return') && isReturnRaw !== undefined) {
            updates.push(`is_return = $${idx++}`);
            values.push(!!isReturnRaw);
            if (!isReturnRaw && availableColumns.has('return_platform')) {
                updates.push(`return_platform = NULL`);
            }
            if (!isReturnRaw && availableColumns.has('return_reason')) {
                updates.push(`return_reason = NULL`);
            }
        }
        if (availableColumns.has('return_platform') && hasReturnPlatformField) {
            if (!returnPlatformRaw) {
                updates.push(`return_platform = NULL`);
            } else {
                if (!returnPlatformAllowed.has(returnPlatformRaw)) {
                    return NextResponse.json({ error: 'Invalid return_platform' }, { status: 400 });
                }
                updates.push(`return_platform = $${idx++}`);
                values.push(returnPlatformRaw);
            }
        }
        if (availableColumns.has('return_reason') && returnReasonRaw !== undefined) {
            updates.push(`return_reason = $${idx++}`);
            values.push(String(returnReasonRaw || '').trim() || null);
        }
        if (availableColumns.has('needs_test') && needsTestRaw !== undefined) {
            updates.push(`needs_test = $${idx++}`);
            values.push(!!needsTestRaw);
            if (!needsTestRaw && availableColumns.has('assigned_tech_id')) {
                updates.push(`assigned_tech_id = NULL`);
            }
        }
        if (availableColumns.has('assigned_tech_id') && assignedTechIdRaw !== undefined) {
            const parsed = Number(assignedTechIdRaw);
            updates.push(`assigned_tech_id = $${idx++}`);
            values.push(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
        }
        if (availableColumns.has('target_channel') && hasTargetChannelField) {
            if (!targetChannelRaw) {
                updates.push(`target_channel = NULL`);
            } else {
                if (!targetChannelAllowed.has(targetChannelRaw)) {
                    return NextResponse.json({ error: 'Invalid target_channel' }, { status: 400 });
                }
                updates.push(`target_channel = $${idx++}`);
                values.push(targetChannelRaw);
            }
        }
        if (availableColumns.has('unboxed_by') && unboxedByRaw !== undefined) {
            const parsed = Number(unboxedByRaw);
            updates.push(`unboxed_by = $${idx++}`);
            values.push(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
        }
        if (availableColumns.has('unboxed_at') && unboxedAtRaw !== undefined) {
            updates.push(`unboxed_at = $${idx++}`);
            values.push(unboxedAtRaw ? String(unboxedAtRaw) : null);
        }
        if (availableColumns.has('updated_at')) {
            updates.push(`updated_at = NOW()`);
        }

        if (updates.length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        values.push(id);
        const result = await pool.query(
            `UPDATE receiving
             SET ${updates.join(', ')}
             WHERE id = $${idx}
             RETURNING id`,
            values
        );

        if (result.rowCount === 0) {
            return NextResponse.json({ error: 'Receiving log not found' }, { status: 404 });
        }

        await invalidateCacheTags(['receiving-logs']);
        return NextResponse.json({ success: true, id });
    } catch (error: any) {
        console.error('Error updating receiving log:', error);
        return NextResponse.json(
            { error: 'Failed to update receiving log', details: error.message },
            { status: 500 }
        );
    }
}
