import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { orders, shipped, skuStock, tech1, tech2, tech3, packer1, packer2, packer3 } from '@/lib/drizzle/schema';
import { eq, and, isNotNull, notInArray, sql, inArray } from 'drizzle-orm';
import { searchItemBySku, getStockInfo } from '@/lib/zoho';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
    try {
        const { scriptName } = await req.json();

        switch (scriptName) {
            case 'checkTrackingInShipped':
                return await executeCheckTrackingInShipped();
            case 'removeDuplicateShipped':
                return await executeRemoveDuplicateShipped();
            case 'transferExistingOrdersToRestock':
                return await executeTransferExistingOrdersToRestock();
            case 'calculateLateOrders':
                return await executeCalculateLateOrders();
            case 'removeDuplicateOrders':
                return await executeRemoveDuplicateOrders();
            case 'updateSkuStockFromShipped':
                return await executeUpdateSkuStockFromShipped();
            case 'syncPackerTimestampsToShipped':
                return await executeSyncPackerTimestampsToShipped();
            case 'recheckTechTrackingIntegrity':
                return await executeRecheckTechTrackingIntegrity();
            case 'recheckPackerTrackingIntegrity':
                return await executeRecheckPackerTrackingIntegrity();
            case 'syncStockFromZoho':
                return await executeSyncStockFromZoho();
            case 'packedSkuMatches':
                return await executePackedSkuMatches();
            case 'setupStockSyncTrigger':
                return await executeSetupStockSyncTrigger();
            case 'removeStockSyncTrigger':
                return await executeRemoveStockSyncTrigger();
            default:
                return NextResponse.json({ success: false, error: 'Unknown script name' }, { status: 400 });
        }
    } catch (error: any) {
        console.error('Neon script execution error:', error);
        return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

async function executeCheckTrackingInShipped() {
    // Transfer from orders to shipped where tracking exists but isn't in shipped
    const result = await db.execute(sql`
        INSERT INTO shipped (col_3, col_4, col_5, col_6)
        SELECT o.col_3, o.col_4, o.col_7, o.col_8
        FROM orders o
        WHERE o.col_8 IS NOT NULL AND o.col_8 != ''
        AND NOT EXISTS (
            SELECT 1 FROM shipped s 
            WHERE RIGHT(s.col_6, 8) = RIGHT(o.col_8, 8)
        )
        RETURNING col_6;
    `);

    return NextResponse.json({ 
        success: true, 
        message: `Transferred ${result.length} new rows to Shipped table.` 
    });
}

async function executeRemoveDuplicateShipped() {
    const result = await db.execute(sql`
        DELETE FROM shipped
        WHERE col_1 IN (
            SELECT col_1
            FROM (
                SELECT col_1,
                       ROW_NUMBER() OVER (PARTITION BY col_6 ORDER BY col_1 ASC) as row_num
                FROM shipped
                WHERE col_6 IS NOT NULL AND col_6 != ''
            ) t
            WHERE t.row_num > 1
        );
    `);

    return NextResponse.json({ 
        success: true, 
        message: `Removed duplicates from Shipped table.` 
    });
}

async function executeTransferExistingOrdersToRestock() {
    const result = await db.execute(sql`
        DELETE FROM orders
        WHERE col_8 IN (
            SELECT col_6 FROM shipped 
            WHERE col_2 IS NOT NULL AND col_2 != ''
        ) OR col_3 IN (
            SELECT col_3 FROM shipped 
            WHERE col_2 IS NOT NULL AND col_2 != ''
        );
    `);

    return NextResponse.json({ 
        success: true, 
        message: `Deleted shipped orders from Orders table.` 
    });
}

async function executeCalculateLateOrders() {
    await db.execute(sql`
        UPDATE orders
        SET col_9 = CASE 
            WHEN col_2 IS NULL OR col_2 = '' THEN ''
            ELSE EXTRACT(DAY FROM (CURRENT_DATE - col_2::date))::text
        END
        WHERE col_2 ~ '^\\d{1,2}/\\d{1,2}/\\d{4}';
    `);

    return NextResponse.json({ success: true, message: 'Calculated late orders.' });
}

async function executeRemoveDuplicateOrders() {
    await db.execute(sql`
        DELETE FROM orders
        WHERE col_1 IN (
            SELECT col_1
            FROM (
                SELECT col_1,
                       ROW_NUMBER() OVER (PARTITION BY col_8 ORDER BY col_1 ASC) as row_num
                FROM orders
                WHERE col_8 IS NOT NULL AND col_8 != ''
            ) t
            WHERE t.row_num > 1
        );
    `);

    return NextResponse.json({ success: true, message: 'Removed duplicate orders.' });
}

async function executeUpdateSkuStockFromShipped() {
    await db.execute(sql`
        UPDATE sku_stock
        SET col_5 = '1'
        WHERE col_3 IN (
            SELECT DISTINCT col_10 FROM shipped WHERE col_10 IS NOT NULL AND col_10 != ''
        );
    `);

    return NextResponse.json({ success: true, message: 'Updated SKU stock from Shipped.' });
}

async function executeSyncPackerTimestampsToShipped() {
    const packerTables = ['packer_1', 'packer_2', 'packer_3'];
    for (const table of packerTables) {
        await db.execute(sql.raw(`
            UPDATE shipped s
            SET col_2 = p.col_2,
                col_8 = '${table.toUpperCase()}'
            FROM ${table} p
            WHERE (s.col_2 IS NULL OR s.col_2 = '')
            AND s.col_3 IS NOT NULL AND s.col_3 != ''
            AND s.col_6 IS NOT NULL AND s.col_6 != ''
            AND RIGHT(s.col_6, 8) = RIGHT(p.col_3, 8);
        `));
    }
    return NextResponse.json({ success: true, message: 'Synced packer timestamps to Shipped.' });
}

async function executeRecheckTechTrackingIntegrity() {
    const techTables = ['tech_1', 'tech_2', 'tech_3', 'tech_4'];
    for (const table of techTables) {
        await db.execute(sql.raw(`
            UPDATE ${table} t
            SET col_2 = s.col_4
            FROM shipped s
            WHERE (t.col_2 IS NULL OR t.col_2 = '')
            AND t.col_3 IS NOT NULL AND t.col_3 != ''
            AND RIGHT(t.col_3, 8) = RIGHT(s.col_6, 8);
        `));
    }
    return NextResponse.json({ success: true, message: 'Rechecked Tech tracking integrity.' });
}

async function executeRecheckPackerTrackingIntegrity() {
    const packerTables = ['packer_1', 'packer_2', 'packer_3'];
    for (const table of packerTables) {
        await db.execute(sql.raw(`
            UPDATE ${table} p
            SET col_4 = s.col_4
            FROM shipped s
            WHERE (p.col_4 IS NULL OR p.col_4 = '')
            AND p.col_3 IS NOT NULL AND p.col_3 != ''
            AND RIGHT(p.col_3, 8) = RIGHT(s.col_6, 8);
        `));
    }
    return NextResponse.json({ success: true, message: 'Rechecked Packer tracking integrity.' });
}

async function executeSyncStockFromZoho() {
    try {
        const allSkus = await db.select({
            id: skuStock.col1,
            sku: skuStock.col3
        }).from(skuStock);

        let updatedCount = 0;
        for (const item of allSkus) {
            const sku = item.sku;
            if (!sku) continue;

            try {
                const zohoItem = await searchItemBySku(sku);
                const stockInfo = getStockInfo(zohoItem);

                await db.update(skuStock)
                    .set({ col2: stockInfo.availableQty.toString() })
                    .where(eq(skuStock.col1, item.id));
                
                updatedCount++;
            } catch (err) {
                console.error(`Error syncing SKU ${sku}:`, err);
            }
        }

        return NextResponse.json({ 
            success: true, 
            message: `Synced ${updatedCount} SKUs from Zoho Inventory.` 
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message });
    }
}

async function executePackedSkuMatches() {
    const matches = await db.execute(sql`
        SELECT o.col_1, o.col_9 as sku, ss.col_2 as stock_qty
        FROM orders o
        JOIN sku_stock ss ON o.col_9 = ss.col_3
        WHERE (ss.col_2::numeric) >= 1;
    `);

    return NextResponse.json({ 
        success: true, 
        message: `Found ${matches.length} matching rows with stock.` 
    });
}

async function executeSetupStockSyncTrigger() {
    return NextResponse.json({ 
        success: true, 
        message: 'Hourly stock sync should be configured via Vercel Cron.' 
    });
}

async function executeRemoveStockSyncTrigger() {
    return NextResponse.json({ 
        success: true, 
        message: 'Remove the cron job from your Vercel dashboard.' 
    });
}
