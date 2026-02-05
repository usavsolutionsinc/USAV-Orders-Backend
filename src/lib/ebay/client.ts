import { eBayApi } from 'ebay-api';
import pool from '@/lib/db';
import { refreshEbayAccessToken } from './token-refresh';

/**
 * eBay API Client
 * Handles authentication, token management, and API calls for a specific eBay account
 */
export class EbayClient {
  private api: eBayApi;
  private accountName: string;

  constructor(accountName: string) {
    this.accountName = accountName;
    
    const sandbox = process.env.EBAY_ENVIRONMENT !== 'PRODUCTION';
    
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

  /**
   * Get a valid access token for the account
   * Automatically refreshes if expired or about to expire
   * Returns both access token and refresh token
   */
  async getValidAccessToken(): Promise<{ accessToken: string; refreshToken: string }> {
    // Query database for current token
    const result = await pool.query(
      'SELECT access_token, token_expires_at, refresh_token FROM ebay_accounts WHERE account_name = $1',
      [this.accountName]
    );

    if (!result.rows[0]) {
      throw new Error(`eBay account ${this.accountName} not found in database`);
    }

    const { access_token, token_expires_at, refresh_token } = result.rows[0];

    // Check if token is expired or about to expire (within 5 minutes)
    const expiresAt = new Date(token_expires_at);
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    if (expiresAt < fiveMinutesFromNow) {
      console.log(`[${this.accountName}] Access token expired or expiring soon, refreshing...`);
      const newAccessToken = await this.refreshAccessToken(refresh_token);
      return { accessToken: newAccessToken, refreshToken: refresh_token };
    }

    return { accessToken: access_token, refreshToken: refresh_token };
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

      // Update database with new token
      await pool.query(
        `UPDATE ebay_accounts 
         SET access_token = $1, token_expires_at = $2, updated_at = NOW() 
         WHERE account_name = $3`,
        [accessToken, newExpiresAt, this.accountName]
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
      const { accessToken, refreshToken } = await this.getValidAccessToken();
      
      // Set credentials for this API call
      this.api.oAuth2.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 7200,
        refresh_token_expires_in: 0,
        token_type: 'User Access Token'
      });
      
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

      const response = await this.api.sell.fulfillment.getOrders(params);

      const orders = response.orders || [];
      console.log(`[${this.accountName}] Fetched ${orders.length} orders`);

      return orders;
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
      const { accessToken, refreshToken } = await this.getValidAccessToken();
      
      // Set credentials for this API call
      this.api.oAuth2.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 7200,
        refresh_token_expires_in: 0,
        token_type: 'User Access Token'
      });
      
      const response = await this.api.sell.fulfillment.getOrder(orderId);

      return response;
    } catch (error: any) {
      console.error(`[${this.accountName}] Error fetching order ${orderId}:`, error.message);
      throw new Error(`Failed to fetch order ${orderId} for ${this.accountName}: ${error.message}`);
    }
  }
}
