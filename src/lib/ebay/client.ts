import { eBayApi } from 'ebay-api';
import pool from '@/lib/db';
import { refreshEbayAccessToken, readEbayToken, writeEbayToken } from './token-refresh';
import { tenantQuery } from '@/lib/tenancy/db';

/**
 * eBay API Client
 * Handles authentication, token management, and API calls for a specific eBay account
 */
export class EbayClient {
  private api: eBayApi;
  private accountName: string;
  private sandbox: boolean;
  private orgId: string | null = null;

  constructor(accountName: string) {
    this.accountName = accountName;
    
    const sandbox = process.env.EBAY_ENVIRONMENT !== 'PRODUCTION';
    this.sandbox = sandbox;
    
    this.api = new eBayApi({
      appId: process.env.EBAY_APP_ID!,
      certId: process.env.EBAY_CERT_ID!,
      sandbox: sandbox,
      siteId: 0, // EBAY_US
      marketplaceId: 'EBAY_US',
      acceptLanguage: 'en-US',
      contentLanguage: 'en-US',
      ruName: process.env.EBAY_RU_NAME,
    });
    
    console.log(`[${accountName}] eBay API initialized:`, {
      appId: process.env.EBAY_APP_ID?.substring(0, 20) + '...',
      sandbox,
      ruName: process.env.EBAY_RU_NAME,
    });
  }

  private async getOrganizationId(): Promise<string> {
    if (this.orgId) return this.orgId;
    // RLS bypass lookup via pool (raw connection without GUC)
    const result = await pool.query(
      'SELECT organization_id FROM ebay_accounts WHERE account_name = $1',
      [this.accountName]
    );
    if (!result.rows[0]) {
      throw new Error(`eBay account ${this.accountName} not found in database`);
    }
    this.orgId = result.rows[0].organization_id;
    return this.orgId!;
  }

  private async auditCall<T>(
    method: string,
    endpoint: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    let statusCode = 200;
    let errorMessage: string | null = null;

    try {
      const result = await fn();
      const latencyMs = Date.now() - startTime;
      
      this.logAuditCall(method, endpoint, latencyMs, statusCode, null).catch((err) => {
        console.error(`[${this.accountName}] Failed to save audit log:`, err.message);
      });

      return result;
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      statusCode = error.status || error.statusCode || error.meta?.status || error.response?.status || 500;
      errorMessage = error.message || String(error);

      this.logAuditCall(method, endpoint, latencyMs, statusCode, errorMessage).catch((err) => {
        console.error(`[${this.accountName}] Failed to save audit log (on error):`, err.message);
      });

      throw error;
    }
  }

  private async logAuditCall(
    method: string,
    endpoint: string,
    latencyMs: number,
    statusCode: number,
    errorMessage: string | null
  ): Promise<void> {
    try {
      const orgId = await this.getOrganizationId();
      await tenantQuery(
        orgId,
        `INSERT INTO ebay_api_calls (organization_id, method, endpoint, latency_ms, status_code, error_message, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [orgId, method, endpoint, latencyMs, statusCode, errorMessage]
      );
    } catch (err: any) {
      console.error(`[${this.accountName}] Failed to write audit call to database:`, err.message);
    }
  }

  private async withOAuthCredentials<T>(callback: () => Promise<T>): Promise<T> {
    const { accessToken, refreshToken } = await this.getValidAccessToken();

    this.api.oAuth2.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 7200,
      refresh_token_expires_in: 0,
      token_type: 'User Access Token'
    });

    return callback();
  }

  private getArrayCandidate(payload: any, keys: string[]): any[] {
    for (const key of keys) {
      if (Array.isArray(payload?.[key])) {
        return payload[key];
      }
    }

    return [];
  }

  private isActiveReturnState(state: string): boolean {
    const normalized = String(state || '').trim().toUpperCase();
    if (!normalized) return true;

    return ![
      'CLOSED',
      'CLOSE',
      'COMPLETED',
      'COMPLETE',
      'RESOLVED',
      'REFUNDED',
      'CANCELLED',
      'CANCELED',
    ].includes(normalized);
  }

  /**
   * Get a valid access token for the account
   * Automatically refreshes if expired or about to expire
   * Returns both access token and refresh token (decrypted)
   */
  async getValidAccessToken(): Promise<{ accessToken: string; refreshToken: string }> {
    const orgId = await this.getOrganizationId();
    // Query database for current token using tenantQuery for GUC/RLS context
    const result = await tenantQuery(
      orgId,
      'SELECT access_token, token_expires_at, refresh_token FROM ebay_accounts WHERE account_name = $1',
      [this.accountName]
    );

    if (!result.rows[0]) {
      throw new Error(`eBay account ${this.accountName} not found in database`);
    }

    const { access_token, token_expires_at, refresh_token } = result.rows[0];

    // Read tokens, tolerating both plaintext and encrypted-at-rest storage
    const decryptedAccessToken = readEbayToken(access_token);
    const decryptedRefreshToken = readEbayToken(refresh_token);

    // Check if token is expired or about to expire (within 5 minutes)
    const expiresAt = new Date(token_expires_at);
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    if (expiresAt < fiveMinutesFromNow) {
      console.log(`[${this.accountName}] Access token expired or expiring soon, refreshing...`);
      const newAccessToken = await this.refreshAccessToken(decryptedRefreshToken);
      return { accessToken: newAccessToken, refreshToken: decryptedRefreshToken };
    }

    return { accessToken: decryptedAccessToken, refreshToken: decryptedRefreshToken };
  }

  /**
   * Refresh the access token using the refresh token
   * Uses direct HTTP call to eBay OAuth2 endpoint (more reliable)
   */
  async refreshAccessToken(refreshToken: string): Promise<string> {
    try {
      console.log(`[${this.accountName}] Refreshing access token...`);
      
      // Use direct HTTP call instead of ebay-api library (more reliable)
      const { accessToken, expiresIn } = await refreshEbayAccessToken(
        process.env.EBAY_APP_ID!,
        process.env.EBAY_CERT_ID!,
        refreshToken
      );
      
      const newExpiresAt = new Date(Date.now() + expiresIn * 1000);
      const encryptedAccessToken = writeEbayToken(accessToken);
      const orgId = await this.getOrganizationId();

      // Update database with new token using tenantQuery
      await tenantQuery(
        orgId,
        `UPDATE ebay_accounts 
         SET access_token = $1, token_expires_at = $2, updated_at = NOW() 
         WHERE account_name = $3`,
        [encryptedAccessToken, newExpiresAt, this.accountName]
      );

      console.log(`[${this.accountName}] Access token refreshed successfully (expires in ${expiresIn}s)`);
      return accessToken;
    } catch (error: any) {
      console.error(`[${this.accountName}] Failed to refresh access token:`, error.message);
      throw new Error(`Failed to refresh access token for ${this.accountName}: ${error.message}`);
    }
  }

  /**
   * Fetch orders from eBay Fulfillment API
   */
  async fetchOrders(options: { 
    lastModifiedDate?: string; 
    limit?: number;
    offset?: number;
  } = {}): Promise<any[]> {
    try {
      return this.withOAuthCredentials(async () => {
        const params: any = {
          limit: options.limit || 100,
        };

        if (options.offset) {
          params.offset = options.offset;
        }

        // Add filter for orders modified since last sync
        if (options.lastModifiedDate) {
          params.filter = `lastmodifieddate:[${options.lastModifiedDate}..]`;
        }

        console.log(`[${this.accountName}] Fetching orders with params:`, params);

        return this.auditCall('GET', '/sell/fulfillment/v1/order', async () => {
          const response = await this.api.sell.fulfillment.getOrders(params);
          const orders = response.orders || [];
          console.log(`[${this.accountName}] Fetched ${orders.length} orders`);
          return orders;
        });
      });
    } catch (error: any) {
      console.error(`[${this.accountName}] Error fetching orders:`, error.message);
      throw new Error(`Failed to fetch orders for ${this.accountName}: ${error.message}`);
    }
  }

  /**
   * Get order details by order ID
   */
  async getOrderDetails(orderId: string): Promise<any> {
    try {
      return this.withOAuthCredentials(async () => 
        this.auditCall('GET', `/sell/fulfillment/v1/order/${orderId}`, async () => 
          this.api.sell.fulfillment.getOrder(orderId)
        )
      );
    } catch (error: any) {
      console.error(`[${this.accountName}] Error fetching order ${orderId}:`, error.message);
      throw new Error(`Failed to fetch order ${orderId} for ${this.accountName}: ${error.message}`);
    }
  }

  async fetchUnreadMessages(limit = 10): Promise<any[]> {
    try {
      return this.withOAuthCredentials(async () => {
        return this.auditCall('GET', '/commerce/message/v1/conversation', async () => {
          const response = await this.api.commerce.message.getConversations({
            limit: Math.max(1, Math.min(limit, 50)),
            offset: 0,
          });

          const conversations = Array.isArray(response?.conversations) ? response.conversations : [];

          return conversations
            .filter((conversation: any) => Number(conversation?.unreadCount || 0) > 0)
            .sort((a: any, b: any) => {
              const aTime = new Date(a?.latestMessage?.createdDate || a?.createdDate || 0).getTime();
              const bTime = new Date(b?.latestMessage?.createdDate || b?.createdDate || 0).getTime();
              return bTime - aTime;
            })
            .slice(0, limit)
            .map((conversation: any) => ({
              conversationId: String(conversation?.conversationId || ''),
              subject: String(
                conversation?.latestMessage?.subject ||
                  conversation?.conversationTitle ||
                  conversation?.referenceId ||
                  'eBay conversation'
              ),
              otherPartyUsername: String(
                conversation?.latestMessage?.senderUsername ||
                  conversation?.latestMessage?.recipientUsername ||
                  'Buyer'
              ),
              unreadCount: Number(conversation?.unreadCount || 0),
              referenceId: String(conversation?.referenceId || ''),
              referenceType: String(conversation?.referenceType || ''),
              createdDate: String(conversation?.latestMessage?.createdDate || conversation?.createdDate || ''),
              conversationStatus: String(conversation?.conversationStatus || ''),
              conversationType: String(conversation?.conversationType || ''),
            }));
        });
      });
    } catch (error: any) {
      console.error(`[${this.accountName}] Error fetching unread messages:`, error.message);
      throw new Error(`Failed to fetch unread messages for ${this.accountName}: ${error.message}`);
    }
  }

  async fetchOpenReturns(limit = 10): Promise<any[]> {
    try {
      return this.withOAuthCredentials(async () => {
        return this.auditCall('GET', '/post-order/v2/return/search', async () => {
          const response = await this.api.postOrder.return.search({
            limit: Math.max(1, Math.min(limit * 3, 50)),
            offset: 0,
            role: 'SELLER',
          });

          const returns = this.getArrayCandidate(response, ['returns', 'members', 'items', 'returnRequests']);

          return returns
            .filter((entry: any) =>
              this.isActiveReturnState(
                String(
                  entry?.returnState ||
                    entry?.state ||
                    entry?.status ||
                    entry?.returnStatus ||
                    ''
                )
              )
            )
            .slice(0, limit)
            .map((entry: any) => ({
              returnId: String(entry?.returnId || entry?.id || ''),
              orderId: String(entry?.orderId || entry?.order?.orderId || ''),
              itemId: String(entry?.itemId || entry?.item?.itemId || ''),
              state: String(
                entry?.returnState ||
                  entry?.state ||
                  entry?.status ||
                  entry?.returnStatus ||
                  'OPEN'
              ),
              creationDate: String(
                entry?.creationDate ||
                  entry?.creationDateValue ||
                  entry?.creationDateTime ||
                  entry?.lastModifiedDate ||
                  ''
              ),
              lastModifiedDate: String(entry?.lastModifiedDate || entry?.creationDate || ''),
            }));
        });
      });
    } catch (error: any) {
      console.error(`[${this.accountName}] Error fetching return requests:`, error.message);
      throw new Error(`Failed to fetch return requests for ${this.accountName}: ${error.message}`);
    }
  }

  /**
   * Get all shipping fulfillments for an order.
   * Tracking is returned in fulfillments[].shipmentTrackingNumber when available.
   */
  async getOrderShippingFulfillments(orderId: string): Promise<any[]> {
    try {
      const { accessToken } = await this.getValidAccessToken();
      const apiBase = this.sandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
      const url = `${apiBase}/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`;

      return this.auditCall('GET', `/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`, async () => {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          const error: any = new Error(`Failed to fetch shipping fulfillments (${response.status}): ${text}`);
          error.status = response.status;
          throw error;
        }

        const data = await response.json().catch(() => ({}));
        return Array.isArray(data?.fulfillments) ? data.fulfillments : [];
      });
    } catch (error: any) {
      console.error(`[${this.accountName}] Error fetching shipping fulfillments for order ${orderId}:`, error.message);
      throw new Error(`Failed to fetch shipping fulfillments for ${orderId}: ${error.message}`);
    }
  }
}

