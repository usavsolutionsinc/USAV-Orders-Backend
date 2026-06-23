import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

function incrementSkuCounting(currentCounting: string) {
    const firstChar = currentCounting.charAt(0);
    const lastTwo = currentCounting.substring(1);
    const number = parseInt(lastTwo);
    const isFirstCharLetter = /[A-Z]/.test(firstChar);

    if (isFirstCharLetter) {
        if (number < 99) {
            return firstChar + String(number + 1).padStart(2, '0');
        } else {
            if (firstChar === 'Z') {
                return '0A0';
            } else {
                const nextLetter = String.fromCharCode(firstChar.charCodeAt(0) + 1);
                return nextLetter + '00';
            }
        }
    } else if (/^\d[A-Z]\d$/.test(currentCounting)) {
        const middleChar = currentCounting.charAt(1);
        const lastDigit = parseInt(currentCounting.charAt(2));
        if (lastDigit < 9) {
            return firstChar + middleChar + (lastDigit + 1);
        } else {
            if (middleChar === 'Z') {
                const firstDigit = parseInt(firstChar);
                if (firstDigit < 9) {
                    return (firstDigit + 1) + 'A0';
                } else {
                    return '00A';
                }
            } else {
                const nextLetter = String.fromCharCode(middleChar.charCodeAt(0) + 1);
                return firstChar + nextLetter + '0';
            }
        }
    } else {
        const lastChar = currentCounting.charAt(2);
        const firstTwoDigits = parseInt(currentCounting.substring(0, 2));
        if (lastChar === 'Z') {
            if (firstTwoDigits < 99) {
                return String(firstTwoDigits + 1).padStart(2, '0') + 'A';
            } else {
                return 'A00';
            }
        } else {
            const nextLetter = String.fromCharCode(lastChar.charCodeAt(0) + 1);
            return currentCounting.substring(0, 2) + nextLetter;
        }
    }
}

// GET with action=increment mutates DB (allocates next SKU counter), so
// gated to sku_stock.manage. action=current is read-only but kept under
// the same gate for simplicity — both flows are inventory-team scoped.
export const GET = withAuth(async (request: NextRequest, ctx) => {
    try {
        const { searchParams } = new URL(request.url);
        const baseSku = searchParams.get('baseSku');
        const action = searchParams.get('action') || 'current';

        if (!baseSku) {
            return NextResponse.json({ error: 'Missing baseSku parameter' }, { status: 400 });
        }

        const orgId = ctx.organizationId;

        // sku_management has no organization_id column yet (NEEDS-COL): scope
        // via the session GUC only (tenantQuery) — no explicit org filter to add.
        const result = await tenantQuery(orgId, 'SELECT * FROM sku_management WHERE base_sku = $1', [baseSku]);
        const skuRecord = result.rows[0];

        if (action === 'current') {
            // Return the current SKU from DB (the one that will be used next)
            if (skuRecord) {
                return NextResponse.json({ currentSku: `${baseSku}:${skuRecord.current_sku_counting}` });
            } else {
                // First time using this SKU - return A00 (will be created on first increment)
                return NextResponse.json({ currentSku: `${baseSku}:A00` });
            }
        }

        if (action === 'increment') {
            // Increment and save to DB for next time
            if (skuRecord) {
                const nextCounting = incrementSkuCounting(skuRecord.current_sku_counting);
                // GUC-wrapped write — sku_management is NEEDS-COL so there is no
                // organization_id to stamp or to add to the WHERE clause.
                await tenantQuery(
                    orgId,
                    'UPDATE sku_management SET current_sku_counting = $1, updated_at = CURRENT_TIMESTAMP WHERE base_sku = $2',
                    [nextCounting, baseSku]
                );
                return NextResponse.json({ nextSku: `${baseSku}:${nextCounting}`, currentSku: `${baseSku}:${nextCounting}` });
            } else {
                // First time - set to A01 (since A00 was just used).
                // sku_management grew an organization_id column (2026-06-14
                // phase-B needs-col-2) with a GUC-or-USAV default. tenantQuery
                // sets the GUC so the default would stamp correctly, but stamp
                // explicitly to match the project convention and survive a future
                // GUC-only default restore for tenant #2.
                await tenantQuery(
                    orgId,
                    'INSERT INTO sku_management (base_sku, current_sku_counting, organization_id) VALUES ($1, $2, $3::uuid)',
                    [baseSku, 'A01', orgId]
                );
                return NextResponse.json({ nextSku: `${baseSku}:A01`, currentSku: `${baseSku}:A01` });
            }
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: any) {
        console.error('SKU Manager error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}, { permission: 'sku_stock.manage' });

