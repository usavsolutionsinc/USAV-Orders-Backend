/**
 * Provider catalog for Settings → Integrations — the single source of truth for
 * what shows on the page, how each provider connects, and where its OAuth /
 * health endpoints live. Adding a provider is one entry here.
 *
 * `connect` drives the card's action set:
 *   - 'amazon' : region picker + OAuth + paste-refresh-token + health + per-account disconnect
 *   - 'ebay'   : OAuth connect (account label) + per-account token refresh
 *   - 'oauth'  : single OAuth redirect (+ optional health) + vault disconnect
 *   - 'vault'  : paste-JSON credential entry via the admin vault + disconnect
 */

export type ConnectMethod = 'amazon' | 'ebay' | 'oauth' | 'vault' | 'nango';

export interface ProviderDef {
  key: string; // organization_integrations.provider key
  label: string;
  description: string;
  category: string;
  connect: ConnectMethod;
  /** GET route that 302s into the provider consent screen. */
  oauthStartPath?: string;
  /** GET route that live-checks the stored credentials. */
  healthPath?: string;
  /** Which per-account table backs this provider's account list, if any. */
  accountsKind?: 'amazon' | 'ebay';
  docsUrl?: string;
  /** Monogram badge classes (bg + text). */
  badge: string;
}

export const INTEGRATION_CATEGORIES = [
  'Marketplaces',
  'Storefronts & POS',
  'Operations',
  'Storage & Backup',
  'Support',
  'Shipping carriers',
  'Realtime & AI',
] as const;

export const PROVIDER_CATALOG: ProviderDef[] = [
  // ── Marketplaces ──
  {
    key: 'amazon',
    label: 'Amazon',
    description: 'Selling Partner API — import sales orders (SKU / FBA-item scoped).',
    category: 'Marketplaces',
    connect: 'amazon',
    oauthStartPath: '/api/amazon/oauth/start',
    healthPath: '/api/amazon/health',
    accountsKind: 'amazon',
    docsUrl: 'https://developer-docs.amazon.com/sp-api/',
    badge: 'bg-orange-100 text-orange-700',
  },
  {
    key: 'ebay',
    label: 'eBay',
    description: 'Selling: storefront orders + tracking. Purchasing: buyer-account orders flow into Incoming.',
    category: 'Marketplaces',
    connect: 'ebay',
    oauthStartPath: '/api/ebay/connect',
    healthPath: '/api/ebay/health',
    accountsKind: 'ebay',
    docsUrl: 'https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html',
    badge: 'bg-blue-100 text-blue-700',
  },

  // ── Storefronts & POS ──
  {
    key: 'ecwid',
    label: 'Ecwid',
    description: 'Storefront catalog + orders.',
    category: 'Storefronts & POS',
    connect: 'vault',
    badge: 'bg-sky-100 text-sky-700',
  },
  {
    key: 'square',
    label: 'Square',
    description: 'In-store POS + walk-ins — OAuth via the Nango connector.',
    category: 'Storefronts & POS',
    connect: 'nango',
    badge: 'bg-slate-200 text-slate-700',
  },

  // ── Operations ──
  {
    key: 'zoho',
    label: 'Zoho Inventory',
    description: 'Sales orders, purchase orders, invoices.',
    category: 'Operations',
    connect: 'oauth',
    oauthStartPath: '/api/zoho/oauth/authorize',
    healthPath: '/api/zoho/health',
    badge: 'bg-red-100 text-red-700',
  },
  {
    key: 'google_sheets',
    label: 'Google Sheets',
    description: 'Order transfer pipelines.',
    category: 'Operations',
    connect: 'vault',
    badge: 'bg-green-100 text-green-700',
  },

  // ── Storage & Backup ──
  {
    key: 'google_drive',
    label: 'Google Drive',
    description: 'Back up photo originals to your own Google Drive — sign in with Google, no storage to pay us for.',
    category: 'Storage & Backup',
    connect: 'oauth',
    oauthStartPath: '/api/integrations/google-drive/connect',
    healthPath: '/api/integrations/google-drive/health',
    docsUrl: 'https://developers.google.com/drive/api/guides/about-sdk',
    badge: 'bg-yellow-100 text-yellow-700',
  },

  // ── Support ──
  {
    key: 'zendesk',
    label: 'Zendesk',
    description: 'Warranty + customer ticket linkage.',
    category: 'Support',
    connect: 'vault',
    badge: 'bg-emerald-100 text-emerald-700',
  },
  {
    key: 'nextiva',
    label: 'Nextiva',
    description: 'Business phone — call log, voicemail follow-ups, click-to-call.',
    category: 'Support',
    connect: 'vault',
    healthPath: '/api/integrations/nextiva/health',
    badge: 'bg-violet-100 text-violet-700',
  },

  // ── Shipping carriers ──
  { key: 'ups',  label: 'UPS',   description: 'Tracking + webhook callbacks.', category: 'Shipping carriers', connect: 'vault', badge: 'bg-amber-100 text-amber-800' },
  { key: 'fedex', label: 'FedEx', description: 'Shipment tracking.',           category: 'Shipping carriers', connect: 'vault', badge: 'bg-purple-100 text-purple-700' },
  { key: 'usps', label: 'USPS',  description: 'OAuth + label tracking.',       category: 'Shipping carriers', connect: 'vault', badge: 'bg-blue-100 text-blue-800' },
  { key: 'shipstation', label: 'ShipStation', description: 'Rate-shop + buy/void labels (v2) and pull orders (v1).', category: 'Shipping carriers', connect: 'vault', docsUrl: 'https://docs.shipstation.com/', badge: 'bg-violet-100 text-violet-700' },

  // ── Realtime & AI ──
  { key: 'ollama', label: 'Ollama (AI)', description: 'Local LLM via Cloudflare tunnel.',    category: 'Realtime & AI', connect: 'vault', badge: 'bg-gray-200 text-gray-700' },
];

// ── Shared status shapes (server-computed, passed to the client cards) ──

export type ProviderConnState = 'connected' | 'error' | 'not_connected';

export interface AccountSummary {
  id?: number;
  label: string;
  status: 'active' | 'error' | 'expiring' | 'revoked' | 'unknown';
  detail?: string;
  /** eBay only: 'seller' (outbound) vs 'buyer' (purchasing → Universal Incoming). */
  role?: 'seller' | 'buyer';
}

export interface ProviderState {
  status: ProviderConnState;
  displayLabel: string | null;
  lastError: string | null;
  updatedAt: string | null;
  accounts: AccountSummary[];
}

export function monogram(label: string): string {
  return (label.trim()[0] || '?').toUpperCase();
}

/**
 * The permission a user needs to connect/disconnect/health-check this provider —
 * mirrors what the underlying routes enforce server-side. Amazon/eBay/Zoho run
 * through their own `integrations.*`-gated routes; vault providers go through the
 * admin credential vault (`admin.manage_features`).
 */
export function managePermission(def: ProviderDef): string {
  if (def.connect === 'amazon') return 'integrations.amazon';
  if (def.connect === 'ebay') return 'integrations.ebay';
  if (def.connect === 'oauth' && def.key === 'zoho') return 'integrations.zoho';
  if (def.connect === 'oauth' && def.key === 'google_drive') return 'integrations.google_drive';
  return 'admin.manage_features';
}
