import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { orders, shipped, skuStock, tech1, tech2, tech3, tech4, packer1, packer2, packer3 } from '@/lib/drizzle/schema';
import { eq, sql, inArray, and, isNotNull } from 'drizzle-orm';

function getLastEightDigits(str: any) {
    return String(str || '').trim().slice(-8).toLowerCase();
}

function normalizeSku(sku: any) {
    if (sku === null || sku === undefined) return "";
    let s = String(sku).replace(/\s+/g, "");
    s = s.replace(/^0+(?!$)/, '');
    return s.toLowerCase();
}

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
            default:
                return NextResponse.json({ success: false, error: 'Unknown script name' }, { status: 400 });
        }
    } catch (error: any) {
        console.error('Script execution error:', error);
        return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

async function executeCheckTrackingInShipped() {
    // Read from orders table where col_8 (tracking) has a value
    const ordersData = await db.select().from(orders).where(isNotNull(orders.col8));

    // Read existing shipped tracking numbers from col_6
    const shippedData = await db.select({ tracking: shipped.col6 }).from(shipped);
    const shippedTrackingSet = new Set(
        shippedData
            .map(s => getLastEightDigits(s.tracking || ''))
            .filter(t => t)
    );

    // Find orders not in shipped
    const newShipped = [];
    const processedOrders = [];

    for (const order of ordersData) {
        const tracking = String(order.col8 || '').trim();
        if (tracking) {
            const trackingKey = getLastEightDigits(tracking);
            if (!shippedTrackingSet.has(trackingKey)) {
                newShipped.push({
                    col2: '',                    // Date/Time (empty initially)
                    col3: order.col3 || '',      // Order ID
                    col4: order.col4 || '',      // Product Title
                    col5: order.col7 || '',      // Condition
                    col6: tracking,              // Tracking Number
                    col7: '',                    // Serial Number (empty)
                    col8: '',                    // Box (empty)
                    col9: '',                    // By (empty)
                    col10: order.col6 || '',     // SKU
                });
                shippedTrackingSet.add(trackingKey);
            }
            processedOrders.push(order.col1);
        }
    }

    // Insert into shipped table
    if (newShipped.length > 0) {
        await db.insert(shipped).values(newShipped);
    }

    // Mark orders as processed (col_9 = 'green' or processed status)
    if (processedOrders.length > 0) {
        await db.update(orders)
            .set({ col9: 'processed' })
            .where(inArray(orders.col1, processedOrders));
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${ordersData.length} orders. Transferred ${newShipped.length} new rows to Shipped. ${processedOrders.length} orders marked as processed.` 
    });
}

async function executeRemoveDuplicateShipped() {
    // Get all shipped records
    const shippedData = await db.select().from(shipped).orderBy(shipped.col1);
    
    const trackingMap = new Map();
    const idsToDelete: number[] = [];

    for (const row of shippedData) {
        const tracking = String(row.col6 || '').trim();
        if (tracking) {
            if (trackingMap.has(tracking)) {
                // Duplicate found, mark for deletion
                idsToDelete.push(row.col1);
            } else {
                // First occurrence, keep it
                trackingMap.set(tracking, row.col1);
            }
        }
    }

    // Delete duplicate rows
    if (idsToDelete.length > 0) {
        await db.delete(shipped).where(inArray(shipped.col1, idsToDelete));
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${shippedData.length} rows. Removed ${idsToDelete.length} duplicate tracking numbers.` 
    });
}

async function executeTransferExistingOrdersToRestock() {
    // Get all shipped records with date/time (col_2 is not empty)
    const shippedData = await db.select().from(shipped).where(isNotNull(shipped.col2));
    
    const shippedTrackings = new Set<string>();
    const shippedOrderIds = new Set<string>();

    for (const row of shippedData) {
        if (row.col6) shippedTrackings.add(getLastEightDigits(row.col6));
        if (row.col3) shippedOrderIds.add(String(row.col3).trim());
    }

    // Get all orders
    const ordersData = await db.select().from(orders);
    const idsToDelete: number[] = [];

    for (const order of ordersData) {
        const orderId = String(order.col3 || '').trim();
        const tracking = String(order.col8 || '').trim();
        
        if ((tracking && shippedTrackings.has(getLastEightDigits(tracking))) || 
            (orderId && shippedOrderIds.has(orderId))) {
            idsToDelete.push(order.col1);
        }
    }

    // Delete shipped orders from orders table
    if (idsToDelete.length > 0) {
        await db.delete(orders).where(inArray(orders.col1, idsToDelete));
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${ordersData.length} orders. Deleted ${idsToDelete.length} shipped orders from Orders table.` 
    });
}

async function executeCalculateLateOrders() {
    // Get all orders
    const ordersData = await db.select().from(orders);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let calculatedCount = 0;

    for (const order of ordersData) {
        const shipByDate = order.col2; // Ship by date in col_2
        let lateValue = "";
        
        if (shipByDate) {
            const orderDate = new Date(shipByDate);
            if (!isNaN(orderDate.getTime())) {
                orderDate.setHours(0, 0, 0, 0);
                const daysDiff = Math.floor((today.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
                if (daysDiff === 0) lateValue = "*";
                else if (daysDiff >= 1) lateValue = String(daysDiff);
                calculatedCount++;
            }
        }
        
        // Update col_9 with late status (column H in sheet)
        await db.update(orders)
            .set({ col9: lateValue })
            .where(eq(orders.col1, order.col1));
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${ordersData.length} orders. Calculated late status for ${calculatedCount} orders.` 
    });
}

async function executeRemoveDuplicateOrders() {
    // Get all orders
    const ordersData = await db.select().from(orders).orderBy(orders.col1);
    
    const trackingMap = new Map();
    const idsToDelete: number[] = [];

    for (const order of ordersData) {
        const tracking = String(order.col8 || '').trim(); // col_8 is tracking (column G)
        if (tracking) {
            if (trackingMap.has(tracking)) {
                // Duplicate found
                idsToDelete.push(order.col1);
            } else {
                // First occurrence
                trackingMap.set(tracking, order.col1);
            }
        }
    }

    // Delete duplicate orders
    if (idsToDelete.length > 0) {
        await db.delete(orders).where(inArray(orders.col1, idsToDelete));
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${ordersData.length} orders. Removed ${idsToDelete.length} duplicate tracking numbers.` 
    });
}

async function executeUpdateSkuStockFromShipped() {
    // Get all SKUs from shipped (col_10)
    const shippedData = await db.select({ sku: shipped.col10 }).from(shipped);
    const shippedSkus = new Set(
        shippedData
            .map(s => normalizeSku(s.sku))
            .filter(s => s)
    );

    // Get all SKU stock records
    const skuStockData = await db.select().from(skuStock);
    let updatedCount = 0;

    for (const stock of skuStockData) {
        const sku = normalizeSku(stock.col2); // col_2 is SKU column (B)
        if (sku && shippedSkus.has(sku)) {
            // Update col_6 (column F) to mark as shipped
            await db.update(skuStock)
                .set({ col6: '1' })
                .where(eq(skuStock.col1, stock.col1));
            updatedCount++;
        }
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${skuStockData.length} SKUs. Matched and updated ${updatedCount} rows in Sku-Stock.` 
    });
}

async function executeSyncPackerTimestampsToShipped() {
    // Get shipped records without timestamps (col_2 is empty)
    const shippedData = await db.select().from(shipped);
    
    let processedCount = 0;
    let updatedCount = 0;

    const packerTables = [packer1, packer2, packer3];
    
    for (const packerTable of packerTables) {
        // Get packer data
        const packerData = await db.select().from(packerTable);
        
        for (const shipRow of shippedData) {
            // If shipped has no timestamp but has order ID and tracking
            if (!shipRow.col2 && shipRow.col3 && shipRow.col6) {
                processedCount++;
                
                // Find matching packer row by tracking number
                for (const packRow of packerData) {
                    if (packRow.col3 && // packer has tracking in col_3
                        getLastEightDigits(packRow.col3) === getLastEightDigits(shipRow.col6) &&
                        packRow.col2) { // packer has timestamp
                        
                        // Update shipped timestamp
                        await db.update(shipped)
                            .set({ col2: packRow.col2 })
                            .where(eq(shipped.col1, shipRow.col1));
                        updatedCount++;
                        break;
                    }
                }
            }
        }
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${processedCount} Shipped rows. Successfully synced ${updatedCount} timestamps from Packer tables.` 
    });
}

async function executeRecheckTechTrackingIntegrity() {
    // Get shipped data with product titles and tracking
    const shippedData = await db.select().from(shipped);
    
    let processedCount = 0;
    let fixedCount = 0;

    const techTables = [tech1, tech2, tech3, tech4];
    
    for (const techTable of techTables) {
        // Get tech data
        const techData = await db.select().from(techTable);
        
        for (const techRow of techData) {
            const techTracking = techRow.col3; // Tech tracking in col_3 (column C)
            if (techTracking) {
                processedCount++;
                
                // Find matching shipped row by tracking
                for (const shipRow of shippedData) {
                    if (shipRow.col6 && // shipped tracking in col_6
                        getLastEightDigits(shipRow.col6) === getLastEightDigits(techTracking)) {
                        
                        // Update tech product title from shipped (col_4 -> col_2)
                        await db.update(techTable)
                            .set({ col2: shipRow.col4 }) // Update product title
                            .where(eq(techTable.col1, techRow.col1));
                        fixedCount++;
                        break;
                    }
                }
            }
        }
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${processedCount} Tech tracking rows. Found and synced ${fixedCount} product titles from Shipped data.` 
    });
}

async function executeRecheckPackerTrackingIntegrity() {
    // Get shipped data with product titles and tracking
    const shippedData = await db.select().from(shipped);
    
    let processedCount = 0;
    let fixedCount = 0;

    const packerTables = [packer1, packer2, packer3];
    
    for (const packerTable of packerTables) {
        // Get packer data
        const packerData = await db.select().from(packerTable);
        
        for (const packRow of packerData) {
            const packTracking = packRow.col3; // Packer tracking in col_3 (column B in UI)
            if (packTracking) {
                processedCount++;
                
                // Find matching shipped row by tracking
                for (const shipRow of shippedData) {
                    if (shipRow.col6 && // shipped tracking in col_6
                        getLastEightDigits(shipRow.col6) === getLastEightDigits(packTracking)) {
                        
                        // Update packer carrier/product from shipped (col_4 -> col_5)
                        await db.update(packerTable)
                            .set({ col5: shipRow.col4 }) // Update product title in col_5
                            .where(eq(packerTable.col1, packRow.col1));
                        fixedCount++;
                        break;
                    }
                }
            }
        }
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${processedCount} Packer tracking rows. Found and synced ${fixedCount} product titles from Shipped data.` 
    });
}
