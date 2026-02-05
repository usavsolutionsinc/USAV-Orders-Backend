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
    const lastModifiedFilter = lastSyncDate 
      ? new Date(lastSyncDate).toISOString() 
      : undefined;

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
  
  // Extract buyer information
  const buyerUsername = ebayOrder.buyer?.username || null;
  const buyerEmail = ebayOrder.buyer?.buyerRegistrationAddress?.email || 
                     ebayOrder.buyer?.contactAddress?.email || null;
  
  // Extract tracking number
  const trackingNumber = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipmentTracking?.[0]?.trackingNumber || null;
  
  // Extract order status
  const orderStatus = ebayOrder.orderFulfillmentStatus || 'UNKNOWN';
  
  // Extract dates
  const orderDate = ebayOrder.creationDate ? new Date(ebayOrder.creationDate) : new Date();
  
  try {
    await pool.query(
      `INSERT INTO orders (
        account_source, order_id, buyer_username, buyer_email,
        product_title, sku, order_status, order_date, 
        shipping_tracking_number, raw_order_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (order_id, account_source) 
      DO UPDATE SET
        order_status = EXCLUDED.order_status,
        buyer_username = EXCLUDED.buyer_username,
        buyer_email = EXCLUDED.buyer_email,
        shipping_tracking_number = EXCLUDED.shipping_tracking_number,
        raw_order_data = EXCLUDED.raw_order_data`,
      [
        accountName,
        ebayOrder.orderId, // Use eBay order ID as order_id
        buyerUsername,
        buyerEmail,
        firstItem.title || 'No title',
        firstItem.sku || '',
        orderStatus,
        orderDate,
        trackingNumber,
        JSON.stringify(ebayOrder),
      ]
    );
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
