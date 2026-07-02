/**
 * Connector registry — the BEHAVIOR source of truth for integrations (auth
 * kind, capabilities, and — added per-phase — refresh/validate/sync).
 *
 * The catalog at src/app/settings/integrations/registry.ts stays the DISPLAY
 * SoT (labels, badges, categories, modal copy). Phase 2 reconciles the two so
 * the display catalog derives its behavior bits from here instead of
 * duplicating them. For now this is additive and self-contained.
 *
 * The `Record<IntegrationProvider, …>` makes provider coverage a COMPILE
 * error if a provider is added to the vault enum but missed here.
 */
import type { IntegrationProvider } from '@/lib/integrations/credentials';
import type { Capability, IntegrationConnector } from './types';

const CONNECTORS: Record<IntegrationProvider, IntegrationConnector> = {
  // Marketplaces — real OAuth already exists; sync/refresh wired in Phase 1+.
  ebay: {
    provider: 'ebay',
    authKind: 'oauth',
    capabilities: ['orders', 'inventory'],
    authorizeStartPath: '/api/ebay/connect',
    // Lazy import so the connection reader never pulls in the eBay client.
    sync: (orgId) => import('./ebay').then((m) => m.ebaySync(orgId)),
  },
  amazon: {
    provider: 'amazon',
    authKind: 'oauth',
    capabilities: ['orders', 'inventory'],
    authorizeStartPath: '/api/amazon/oauth/start',
    healthPath: '/api/amazon/health',
    sync: (orgId) => import('./amazon').then((m) => m.amazonSync(orgId)),
  },
  // Operations
  zoho: {
    provider: 'zoho',
    authKind: 'oauth',
    capabilities: ['inventory'],
    authorizeStartPath: '/api/zoho/oauth/authorize',
    healthPath: '/api/zoho/health',
  },
  google_sheets: {
    provider: 'google_sheets',
    authKind: 'vault',
    capabilities: ['orders'],
  },
  // Storage backup — tenant connects their own Google Drive (Sign in with
  // Google, scope drive.file) so photo originals back up to / offload onto
  // storage they own. No ingestion capability; validate()/refresh() are
  // lazy-imported so the connection reader never pulls the Drive client.
  google_drive: {
    provider: 'google_drive',
    authKind: 'oauth',
    capabilities: [],
    authorizeStartPath: '/api/integrations/google-drive/connect',
    healthPath: '/api/integrations/google-drive/health',
    validate: (orgId) => import('@/lib/photos/drive/client').then((m) => m.validateDriveConnection(orgId)),
    refresh: (orgId) => import('@/lib/photos/drive/client').then((m) => m.refreshDriveToken(orgId)),
  },
  // Storefronts & POS
  square: {
    provider: 'square',
    authKind: 'nango',
    capabilities: ['orders'],
    // Lazy import so the connection reader never pulls in the Square client.
    sync: (orgId) => import('./square').then((m) => m.squareSync(orgId)),
  },
  ecwid: {
    provider: 'ecwid',
    authKind: 'vault',
    capabilities: ['orders'],
  },
  // Payments
  stripe: {
    provider: 'stripe',
    authKind: 'vault',
    capabilities: ['payments'],
  },
  // Shipping carriers — hand-built forever (Nango doesn't cover carriers).
  // ShipStation is the label ENGINE (rate-shop + buy/void via v2) AND an order
  // source (pull via legacy v1). Lazy sync import so the reader never bundles it.
  shipstation: {
    provider: 'shipstation',
    authKind: 'vault',
    capabilities: ['orders', 'tracking'],
    sync: (orgId) => import('./shipstation').then((m) => m.shipstationSync(orgId)),
  },
  ups: { provider: 'ups', authKind: 'vault', capabilities: ['tracking'] },
  fedex: { provider: 'fedex', authKind: 'vault', capabilities: ['tracking'] },
  usps: { provider: 'usps', authKind: 'vault', capabilities: ['tracking'] },
  // Support / Realtime / AI — no ingestion capability.
  zendesk: { provider: 'zendesk', authKind: 'vault', capabilities: [] },
  ably: { provider: 'ably', authKind: 'vault', capabilities: [] },
  ollama: { provider: 'ollama', authKind: 'vault', capabilities: [] },
  // Voice — business phone (call log + voicemail follow-ups + click-to-call).
  // authKind is confirmed in the Phase 0 spike; vault is the default. sync() is
  // the catch-up poll (webhooks are the realtime path) — lazy-imported so the
  // connection reader never pulls the Nextiva client.
  nextiva: {
    provider: 'nextiva',
    authKind: 'vault',
    capabilities: ['voice'],
    healthPath: '/api/integrations/nextiva/health',
    sync: (orgId) => import('./nextiva').then((m) => m.nextivaSync(orgId)),
  },
};

/** Connector for a provider, or undefined for an unknown/legacy provider
 *  string (e.g. a stale vault row). */
export function getConnector(provider: string): IntegrationConnector | undefined {
  return (CONNECTORS as Record<string, IntegrationConnector>)[provider];
}

export function listConnectors(): IntegrationConnector[] {
  return Object.values(CONNECTORS);
}

/** Connectors that expose a given capability (e.g. 'orders' for the sync
 *  orchestrator). */
export function connectorsWithCapability(cap: Capability): IntegrationConnector[] {
  return listConnectors().filter((c) => c.capabilities.includes(cap));
}
