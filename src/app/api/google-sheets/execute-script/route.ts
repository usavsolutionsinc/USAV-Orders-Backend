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
    // Read from orders table where shipping_tracking_number has a value
    const ordersData = await db.select().from(orders).where(isNotNull(orders.shippingTrackingNumber));

    // Read existing shipped tracking numbers
    const shippedData = await db.select({ tracking: shipped.shippingTrackingNumber }).from(shipped);
    const shippedTrackingSet = new Set(
        shippedData
            .map(s => getLastEightDigits(s.tracking || ''))
            .filter(t => t)
    );

    // Find orders not in shipped
    const newShipped = [];
    const processedOrders = [];

    for (const order of ordersData) {
        const tracking = String(order.shippingTrackingNumber || '').trim();
        if (tracking) {
            const trackingKey = getLastEightDigits(tracking);
            if (!shippedTrackingSet.has(trackingKey)) {
                newShipped.push({
                    dateTime: '',                           // Date/Time (empty initially)
                    orderId: order.orderId || '',           // Order ID
                    productTitle: order.productTitle || '', // Product Title
                    condition: order.condition || '',       // Condition
                    shippingTrackingNumber: tracking,       // Tracking Number
                    serialNumber: '',                       // Serial Number (empty)
                    boxedBy: '',                            // Box (empty)
                    testedBy: '',                           // By (empty)
                    sku: order.sku || '',                   // SKU
                });
                shippedTrackingSet.add(trackingKey);
            }
            processedOrders.push(order.id);
        }
    }

    // Insert into shipped table
    if (newShipped.length > 0) {
        await db.insert(shipped).values(newShipped);
    }

    // Mark orders as processed
    if (processedOrders.length > 0) {
        await db.update(orders)
            .set({ daysLate: 'processed' })
            .where(inArray(orders.id, processedOrders));
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${ordersData.length} orders. Transferred ${newShipped.length} new rows to Shipped. ${processedOrders.length} orders marked as processed.` 
    });
}

async function executeRemoveDuplicateShipped() {
    // Get all shipped records
    const shippedData = await db.select().from(shipped).orderBy(shipped.id);
    
    const trackingMap = new Map();
    const idsToDelete: number[] = [];

    for (const row of shippedData) {
        const tracking = String(row.shippingTrackingNumber || '').trim();
        if (tracking) {
            if (trackingMap.has(tracking)) {
                // Duplicate found, mark for deletion
                idsToDelete.push(row.id);
            } else {
                // First occurrence, keep it
                trackingMap.set(tracking, row.id);
            }
        }
    }

    // Delete duplicate rows
    if (idsToDelete.length > 0) {
        await db.delete(shipped).where(inArray(shipped.id, idsToDelete));
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${shippedData.length} rows. Removed ${idsToDelete.length} duplicate tracking numbers.` 
    });
}

async function executeTransferExistingOrdersToRestock() {
    // Get all shipped records with date/time
    const shippedData = await db.select().from(shipped).where(isNotNull(shipped.dateTime));
    
    const shippedTrackings = new Set<string>();
    const shippedOrderIds = new Set<string>();

    for (const row of shippedData) {
        if (row.shippingTrackingNumber) shippedTrackings.add(getLastEightDigits(row.shippingTrackingNumber));
        if (row.orderId) shippedOrderIds.add(String(row.orderId).trim());
    }

    // Get all orders
    const ordersData = await db.select().from(orders);
    const idsToDelete: number[] = [];

    for (const order of ordersData) {
        const orderId = String(order.orderId || '').trim();
        const tracking = String(order.shippingTrackingNumber || '').trim();
        
        if ((tracking && shippedTrackings.has(getLastEightDigits(tracking))) || 
            (orderId && shippedOrderIds.has(orderId))) {
            idsToDelete.push(order.id);
        }
    }

    // Delete shipped orders from orders table
    if (idsToDelete.length > 0) {
        await db.delete(orders).where(inArray(orders.id, idsToDelete));
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
        const shipByDate = order.shipByDate;
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
        
        // Update daysLate with late status
        await db.update(orders)
            .set({ daysLate: lateValue })
            .where(eq(orders.id, order.id));
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${ordersData.length} orders. Calculated late status for ${calculatedCount} orders.` 
    });
}

async function executeRemoveDuplicateOrders() {
    // Get all orders
    const ordersData = await db.select().from(orders).orderBy(orders.id);
    
    const trackingMap = new Map();
    const idsToDelete: number[] = [];

    for (const order of ordersData) {
        const tracking = String(order.shippingTrackingNumber || '').trim();
        if (tracking) {
            if (trackingMap.has(tracking)) {
                // Duplicate found
                idsToDelete.push(order.id);
            } else {
                // First occurrence
                trackingMap.set(tracking, order.id);
            }
        }
    }

    // Delete duplicate orders
    if (idsToDelete.length > 0) {
        await db.delete(orders).where(inArray(orders.id, idsToDelete));
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${ordersData.length} orders. Removed ${idsToDelete.length} duplicate tracking numbers.` 
    });
}

async function executeUpdateSkuStockFromShipped() {
    // Get all SKUs from shipped
    const shippedData = await db.select({ sku: shipped.sku }).from(shipped);
    const shippedSkus = new Set(
        shippedData
            .map(s => normalizeSku(s.sku))
            .filter(s => s)
    );

    // Get all SKU stock records
    const skuStockData = await db.select().from(skuStock);
    let updatedCount = 0;

    for (const stock of skuStockData) {
        const sku = normalizeSku(stock.sku);
        if (sku && shippedSkus.has(sku)) {
            // Note: col6 was removed in the new schema to match screenshots
            // If there's a need to mark as shipped, we might need to add that column back
            /*
            await db.update(skuStock)
                .set({ status: 'shipped' })
                .where(eq(skuStock.id, stock.id));
            */
            updatedCount++;
        }
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${skuStockData.length} SKUs. Matched and updated ${updatedCount} rows in Sku-Stock.` 
    });
}

async function executeSyncPackerTimestampsToShipped() {
    // Get shipped records without timestamps
    const shippedData = await db.select().from(shipped);
    
    let processedCount = 0;
    let updatedCount = 0;

    const packerTables = [packer1, packer2, packer3];
    
    for (const packerTable of packerTables) {
        // Get packer data
        const packerData = await db.select().from(packerTable);
        
        for (const shipRow of shippedData) {
            // If shipped has no timestamp but has order ID and tracking
            if (!shipRow.dateTime && shipRow.orderId && shipRow.shippingTrackingNumber) {
                processedCount++;
                
                // Find matching packer row by tracking number
                for (const packRow of packerData) {
                    if (packRow.shippingTrackingNumber &&
                        getLastEightDigits(packRow.shippingTrackingNumber) === getLastEightDigits(shipRow.shippingTrackingNumber) &&
                        packRow.dateTime) {
                        
                        // Update shipped timestamp
                        await db.update(shipped)
                            .set({ dateTime: packRow.dateTime })
                            .where(eq(shipped.id, shipRow.id));
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
            const techTracking = techRow.shippingTrackingNumber;
            if (techTracking) {
                processedCount++;
                
                // Find matching shipped row by tracking
                for (const shipRow of shippedData) {
                    if (shipRow.shippingTrackingNumber &&
                        getLastEightDigits(shipRow.shippingTrackingNumber) === getLastEightDigits(techTracking)) {
                        
                        // Update tech product title from shipped
                        await db.update(techTable)
                            .set({ productTitle: shipRow.productTitle })
                            .where(eq(techTable.id, techRow.id));
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
            const packTracking = packRow.shippingTrackingNumber;
            if (packTracking) {
                processedCount++;
                
                // Find matching shipped row by tracking
                for (const shipRow of shippedData) {
                    if (shipRow.shippingTrackingNumber &&
                        getLastEightDigits(shipRow.shippingTrackingNumber) === getLastEightDigits(packTracking)) {
                        
                        // Update packer product title from shipped
                        await db.update(packerTable)
                            .set({ productTitle: shipRow.productTitle })
                            .where(eq(packerTable.id, packRow.id));
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
