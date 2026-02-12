import { EbayClient } from './client';
import pool from '@/lib/db';

export interface SyncResult {
  accountName: string;
  syncedCount: number;
  lastSyncDate: string | null;
  errors?: string[];
}

/**
 * Sync orders for a single eBay account
 */
export async function syncAccountOrders(accountName: string): Promise<SyncResult> {
  console.log(`Starting sync for account: ${accountName}`);
  
  try {
    const client = new EbayClient(accountName);

    // Get last sync date from database
    const lastSyncResult = await pool.query(
      'SELECT last_sync_date FROM ebay_accounts WHERE account_name = $1',
      [accountName]
    );
    
    const lastSyncDate = lastSyncResult.rows[0]?.last_sync_date;
    
    // Build lastModifiedFilter, accounting for timezone issues
    // Subtract 5 minutes to account for clock drift and timezone conversion
    let lastModifiedFilter: string | undefined = undefined;
    if (lastSyncDate) {
      const syncDate = new Date(lastSyncDate);
      const fiveMinutesAgo = new Date(syncDate.getTime() - 5 * 60 * 1000);
      
      // Don't filter if last sync was very recent (< 1 minute ago) to avoid future date issues
      const timeSinceLastSync = Date.now() - syncDate.getTime();
      if (timeSinceLastSync > 60 * 1000) {
        lastModifiedFilter = fiveMinutesAgo.toISOString();
      }
    }

    console.log(`[${accountName}] Last sync: ${lastSyncDate || 'Never'}`);

    // Fetch orders from eBay
    const ebayOrders = await client.fetchOrders({ 
      lastModifiedDate: lastModifiedFilter,
      limit: 200 
    });

    let syncedCount = 0;
    const errors: string[] = [];

    // Process each order
    for (const order of ebayOrders) {
      try {
        await upsertOrder(accountName, order);
        syncedCount++;
      } catch (error: any) {
        console.error(`[${accountName}] Error processing order ${order.orderId}:`, error.message);
        errors.push(`Order ${order.orderId}: ${error.message}`);
      }
    }

    // Update last sync timestamp
    await pool.query(
      'UPDATE ebay_accounts SET last_sync_date = NOW(), updated_at = NOW() WHERE account_name = $1',
      [accountName]
    );

    console.log(`[${accountName}] Sync completed: ${syncedCount} orders synced`);

    return { 
      accountName, 
      syncedCount, 
      lastSyncDate: lastSyncDate ? new Date(lastSyncDate).toISOString() : null,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (error: any) {
    console.error(`[${accountName}] Sync failed:`, error.message);
    throw new Error(`Failed to sync ${accountName}: ${error.message}`);
  }
}

/**
 * Upsert an order into the database
 * Uses order_id + account_source as unique constraint
 */
async function upsertOrder(accountName: string, ebayOrder: any): Promise<void> {
  const lineItems = ebayOrder.lineItems || [];
  const firstItem = lineItems[0] || {};
  
  // Extract tracking number
  const trackingNumber = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipmentTracking?.[0]?.trackingNumber || null;
  
  // Extract dates
  const orderDate = ebayOrder.creationDate ? new Date(ebayOrder.creationDate) : new Date();
  const quantity = firstItem.quantity ? String(firstItem.quantity) : '1';
  const condition = firstItem.condition || firstItem.conditionId || '';
  const productTitle = firstItem.title || 'No title';
  const sku = firstItem.sku || '';
  
  try {
    // Check if order_id already exists (regardless of account_source)
    const existingOrder = await pool.query(
      `SELECT 
         id, account_source, order_date, sku, shipping_tracking_number,
         product_title, condition, quantity, status, status_history,
         is_shipped, packer_id, notes, out_of_stock, tester_id, ship_by_date
       FROM orders
       WHERE order_id = $1
       LIMIT 1`,
      [ebayOrder.orderId]
    );
    
    if (existingOrder.rows.length > 0) {
      // Order exists - update empty fields
      const current = existingOrder.rows[0];
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;
      
      // Update account_source if empty
      if (!current.account_source || current.account_source === '') {
        updates.push(`account_source = $${paramIndex++}`);
        values.push(accountName);
      }
      
      // Update order_date if empty
      if (!current.order_date) {
        updates.push(`order_date = $${paramIndex++}`);
        values.push(orderDate);
      }
      
      // Update sku if empty
      if (!current.sku || current.sku === '') {
        updates.push(`sku = $${paramIndex++}`);
        values.push(sku);
      }
      
      // Update shipping_tracking_number if empty
      if (!current.shipping_tracking_number && trackingNumber) {
        updates.push(`shipping_tracking_number = $${paramIndex++}`);
        values.push(trackingNumber);
      }

      // Update product_title if empty
      if (!current.product_title || current.product_title === '') {
        updates.push(`product_title = $${paramIndex++}`);
        values.push(productTitle);
      }

      // Update condition if empty
      if (!current.condition || current.condition === '') {
        updates.push(`condition = $${paramIndex++}`);
        values.push(condition);
      }

      // Update quantity if empty
      if (!current.quantity || current.quantity === '') {
        updates.push(`quantity = $${paramIndex++}`);
        values.push(quantity);
      }
      
      if (updates.length > 0) {
        values.push(ebayOrder.orderId); // WHERE condition
        await pool.query(
          `UPDATE orders SET ${updates.join(', ')} WHERE order_id = $${paramIndex}`,
          values
        );
        console.log(`  [${accountName}] Updated ${updates.length} empty fields for order: ${ebayOrder.orderId}`);
      } else {
        console.log(`  [${accountName}] Order ${ebayOrder.orderId} already has all data`);
      }
    } else {
      // Order doesn't exist - create full record with current orders schema defaults
      await pool.query(
        `INSERT INTO orders (
          order_id,
          product_title,
          condition,
          shipping_tracking_number,
          sku,
          status,
          status_history,
          is_shipped,
          packer_id,
          notes,
          quantity,
          out_of_stock,
          account_source,
          order_date,
          tester_id,
          ship_by_date
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16
        )`,
        [
          ebayOrder.orderId,
          productTitle,
          condition,
          trackingNumber,
          sku,
          'unassigned',
          JSON.stringify([]),
          false,
          5,
          '',
          quantity,
          '',
          accountName,
          orderDate,
          6,
          null,
        ]
      );
      console.log(`  [${accountName}] Created new order: ${ebayOrder.orderId}`);
    }
  } catch (error: any) {
    console.error(`Error upserting order ${ebayOrder.orderId}:`, error.message);
    throw error;
  }
}

/**
 * Sync all active eBay accounts
 */
export async function syncAllAccounts(): Promise<Array<{
  account: string;
  status: 'fulfilled' | 'rejected';
  data: SyncResult | null;
  error: string | null;
}>> {
  // Get active accounts from database
  const accountsResult = await pool.query(
    'SELECT account_name FROM ebay_accounts WHERE is_active = true ORDER BY account_name'
  );
  
  const accounts = accountsResult.rows.map(row => row.account_name);
  
  if (accounts.length === 0) {
    console.log('No active eBay accounts found');
    return [];
  }

  console.log(`Syncing ${accounts.length} accounts: ${accounts.join(', ')}`);
  
  // Sync all accounts in parallel
  const results = await Promise.allSettled(
    accounts.map(account => syncAccountOrders(account))
  );

  // Format results
  return results.map((result, i) => ({
    account: accounts[i],
    status: result.status,
    data: result.status === 'fulfilled' ? result.value : null,
    error: result.status === 'rejected' ? result.reason.message : null,
  }));
}

/**
 * Get sync status for all accounts
 */
export async function getSyncStatus() {
  const result = await pool.query(
    `SELECT 
      account_name, 
      last_sync_date, 
      is_active,
      token_expires_at,
      created_at
    FROM ebay_accounts 
    ORDER BY account_name`
  );

  return result.rows.map(row => ({
    accountName: row.account_name,
    lastSyncDate: row.last_sync_date,
    isActive: row.is_active,
    tokenExpiresAt: row.token_expires_at,
    createdAt: row.created_at,
  }));
}
