/**
 * Configuration for the shipped-order → Zoho Inventory fulfillment sync.
 *
 * Everything here is environment-driven so the sync's accounting behavior can be
 * tuned per deployment without code changes. Defaults are deliberately SAFE:
 *   - dry-run is ON by default (the sync logs what it WOULD do but writes nothing
 *     to Zoho) until you explicitly set ZOHO_FULFILLMENT_DRY_RUN=false.
 *   - FBA / Amazon-fulfilled orders are excluded (they are not sold through the
 *     Zoho channel and have their own accounting).
 *
 * See docs/zoho-fulfillment-sync.md for the full setup guide and the field
 * mapping reference.
 */

import { normalizeEnvValue } from '@/lib/env-utils';

/**
 * How far the invoice (accounting record) is taken in Zoho for each shipped order:
 *   - 'none'  : create no invoice (package + shipment only).
 *   - 'draft' : create the invoice but leave it as a Draft.
 *   - 'sent'  : create the invoice and mark it Sent (open accounts-receivable).
 *   - 'paid'  : create + mark Sent + record a full customer payment (closed/paid).
 *               Use this for marketplace orders that are already paid at the source.
 */
export type InvoiceMode = 'none' | 'draft' | 'sent' | 'paid';

export interface FulfillmentSyncConfig {
  /** Accounting depth for the invoice step. Default: 'sent'. */
  invoiceMode: InvoiceMode;
  /** Mark the Zoho shipment Delivered when carrier tracking shows delivered. Default: true. */
  markDeliveredFromTracking: boolean;
  /** Include FBA / Amazon-fulfilled orders. Default: false. */
  includeFba: boolean;
  /** payment_mode used when invoiceMode === 'paid'. Default: 'banktransfer'. */
  paymentMode: string;
  /** First-run delta bootstrap window (days) when no cursor exists yet. Default: 30. */
  bootstrapLookbackDays: number;
  /** Max orders processed per run (function-timeout guard). Default: 100. */
  batchSize: number;
  /** When true, perform NO Zoho writes — log intended actions only. Default: true. */
  dryRunDefault: boolean;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = normalizeEnvValue(process.env[name]).toLowerCase();
  if (raw === '') return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function envInt(name: string, fallback: number): number {
  const n = Number(normalizeEnvValue(process.env[name]));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function envInvoiceMode(): InvoiceMode {
  const raw = normalizeEnvValue(process.env.ZOHO_FULFILLMENT_INVOICE_MODE).toLowerCase();
  if (raw === 'none' || raw === 'draft' || raw === 'sent' || raw === 'paid') return raw;
  return 'sent';
}

export function getFulfillmentSyncConfig(
  overrides: Partial<FulfillmentSyncConfig> = {}
): FulfillmentSyncConfig {
  return {
    invoiceMode: envInvoiceMode(),
    markDeliveredFromTracking: envBool('ZOHO_FULFILLMENT_MARK_DELIVERED', true),
    includeFba: envBool('ZOHO_FULFILLMENT_INCLUDE_FBA', false),
    paymentMode: normalizeEnvValue(process.env.ZOHO_FULFILLMENT_PAYMENT_MODE) || 'banktransfer',
    bootstrapLookbackDays: envInt('ZOHO_FULFILLMENT_BOOTSTRAP_DAYS', 30),
    batchSize: envInt('ZOHO_FULFILLMENT_BATCH_SIZE', 100),
    dryRunDefault: envBool('ZOHO_FULFILLMENT_DRY_RUN', true),
    ...overrides,
  };
}
