/**
 * Direct eBay OAuth2 Token Refresh
 * Converts the Python script to TypeScript for reliable token refreshing
 */

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Refresh eBay access token using direct HTTP call to OAuth2 endpoint
 * This is more reliable than using the ebay-api library
 */
export async function refreshEbayAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  // 1. eBay OAuth2 token endpoint
  const url = 'https://api.ebay.com/identity/v1/oauth2/token';

  // 2. Create Base64 encoded credentials: <client_id>:<client_secret>
  const authString = `${clientId}:${clientSecret}`;
  const base64Auth = Buffer.from(authString).toString('base64');

  // 3. Configure headers
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Authorization': `Basic ${base64Auth}`,
  };

  // 4. Configure payload
  // Define scopes (space-separated)
  const scopes = 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.fulfillment';

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: scopes,
  });

  // 5. Make the request
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const tokenData = await response.json() as TokenResponse;
    
    console.log('✅ Successfully refreshed eBay access token!');
    
    return {
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in || 7200, // Default 2 hours
    };
  } catch (error: any) {
    console.error('❌ Error refreshing eBay access token:', error.message);
    throw new Error(`Failed to refresh eBay access token: ${error.message}`);
  }
}

/**
 * Standalone script for manual token refresh
 * Run with: npx tsx src/lib/ebay/token-refresh.ts
 */
if (require.main === module) {
  require('dotenv').config();
  
  const CLIENT_ID = process.env.EBAY_APP_ID;
  const CLIENT_SECRET = process.env.EBAY_CERT_ID;
  const REFRESH_TOKEN = process.env.EBAY_REFRESH_TOKEN_USAV;

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.error('❌ Missing required environment variables:');
    console.error('   EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN_USAV');
    process.exit(1);
  }

  refreshEbayAccessToken(CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN)
    .then(({ accessToken, expiresIn }) => {
      console.log('\n✅ Your Access Token:');
      console.log(accessToken);
      console.log(`\n⏰ Expires in: ${expiresIn} seconds (${expiresIn / 3600} hours)`);
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}
