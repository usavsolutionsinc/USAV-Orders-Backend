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
  
  try {
    // Check if order_id already exists (regardless of account_source)
    const existingOrder = await pool.query(
      'SELECT id, account_source FROM orders WHERE order_id = $1 LIMIT 1',
      [ebayOrder.orderId]
    );
    
    if (existingOrder.rows.length > 0) {
      // Order exists - only update account_source if not already set
      const currentAccountSource = existingOrder.rows[0].account_source;
      
      if (!currentAccountSource || currentAccountSource === '') {
        await pool.query(
          'UPDATE orders SET account_source = $1 WHERE order_id = $2',
          [accountName, ebayOrder.orderId]
        );
        console.log(`  [${accountName}] Updated account_source for existing order: ${ebayOrder.orderId}`);
      } else {
        console.log(`  [${accountName}] Order ${ebayOrder.orderId} already has account_source: ${currentAccountSource}`);
      }
    } else {
      // Order doesn't exist - create full record
      await pool.query(
        `INSERT INTO orders (
          account_source, order_id, product_title, sku, 
          order_date, shipping_tracking_number
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          accountName,
          ebayOrder.orderId,
          firstItem.title || 'No title',
          firstItem.sku || '',
          orderDate,
          trackingNumber,
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
