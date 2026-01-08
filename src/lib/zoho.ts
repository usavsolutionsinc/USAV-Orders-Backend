/**
 * Zoho Inventory API Client for Next.js
 */

const ZOHO_ORG_ID = process.env.ZOHO_ORG_ID;
const ZOHO_DOMAIN = process.env.ZOHO_DOMAIN || 'accounts.zoho.com';
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;

let tokenCache: {
  accessToken: string | null;
  expiresAt: number | null;
} = {
  accessToken: null,
  expiresAt: null,
};

export async function getAccessToken() {
  const now = Date.now();
  
  if (tokenCache.accessToken && tokenCache.expiresAt && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error('Zoho OAuth credentials missing');
  }

  const tokenUrl = `https://${ZOHO_DOMAIN}/oauth/v2/token`;
  const params = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Zoho token refresh failed: ${response.status}`);
  }

  const data = await response.json();
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in_sec || 3600) * 1000 - 300000,
  };

  return tokenCache.accessToken;
}

export function getInventoryBaseUrl() {
  if (ZOHO_DOMAIN.includes('eu')) return 'https://inventory.zoho.eu';
  if (ZOHO_DOMAIN.includes('in')) return 'https://inventory.zoho.in';
  return 'https://inventory.zoho.com';
}

export async function searchItemBySku(sku: string) {
  if (!ZOHO_ORG_ID) throw new Error('ZOHO_ORG_ID missing');

  const accessToken = await getAccessToken();
  const baseUrl = getInventoryBaseUrl();
  const normalizedSku = sku.replace(/^0+/, '') || '0';
  
  const url = `${baseUrl}/api/v1/items?organization_id=${ZOHO_ORG_ID}&search_text=${encodeURIComponent(normalizedSku)}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) throw new Error(`Zoho API error: ${response.status}`);

  const data = await response.json();
  const items = data.items || [];
  
  return items.find((item: any) => {
    const itemSku = String(item.sku || '').replace(/^0+/, '') || '0';
    return itemSku.toLowerCase() === normalizedSku.toLowerCase();
  }) || items[0] || null;
}

export function getStockInfo(item: any) {
  if (!item) return { availableQty: 0, status: 'Not Found' };

  let availableQty = 0;
  if (item.available_stock !== undefined) availableQty = Number(item.available_stock);
  else if (item.stock_on_hand !== undefined) availableQty = Number(item.stock_on_hand);
  
  return {
    availableQty,
    status: availableQty > 0 ? 'In Stock' : 'Out of Stock'
  };
}
