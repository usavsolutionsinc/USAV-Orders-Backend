import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { orders } from '@/lib/drizzle/schema';
import { eq, inArray } from 'drizzle-orm';

export async function POST(req: NextRequest) {
    try {
        const { scriptName } = await req.json();

        switch (scriptName) {
            case 'calculateLateOrders':
                return await executeCalculateLateOrders();
            case 'removeDuplicateOrders':
                return await executeRemoveDuplicateOrders();
            default:
                return NextResponse.json({ success: false, error: 'Unknown script name' }, { status: 400 });
        }
    } catch (error: any) {
        console.error('Script execution error:', error);
        return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
    }
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
