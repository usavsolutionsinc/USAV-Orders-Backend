/**
 * Shipped-order → Zoho Inventory fulfillment sync (the accounting reconciliation).
 *
 * For every order that has SHIPPED in our authoritative internal system, this
 * walks the Zoho fulfillment chain so a proper financial record exists:
 *
 *   sales order  →  package  →  shipment order  →  (delivered)  →  invoice
 *
 * Design goals (see docs/zoho-fulfillment-sync.md):
 *   - Idempotent: safe to run repeatedly. Every Zoho id we create is recorded in
 *     the `zoho_fulfillment_sync` ledger, and each step also re-checks Zoho
 *     (reference_number lookups / existing packages) before creating anything.
 *   - Incremental: the caller passes `since` (a delta cursor); only changed
 *     shipped orders are processed.
 *   - Dry-run: when dryRun is true NOTHING is written to Zoho — the intended
 *     actions are logged and recorded for review.
 *   - Auditable: the ledger holds every Zoho id + the final status per order, and
 *     each result carries a human-readable `actions` trail.
 *
 * Reuses the existing building blocks rather than reinventing them:
 *   - ZohoInventoryClient (createPackage / createShipmentOrder / createInvoice / …)
 *     on top of the rate-limited, retrying, circuit-breaking httpClient.
 *   - OrderSyncService.ingestExternalOrder to create+confirm a Zoho sales order
 *     (with contact + item resolution) when one doesn't exist yet.
 */

import pool from '@/lib/db';
import { getCurrentPSTDateKey } from '@/utils/date';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';
import { zohoClient, ZohoInventoryClient } from '@/lib/zoho/ZohoInventoryClient';
import { salesOrderRepository } from '@/lib/repositories/salesOrderRepository';
import { orderSyncService, type ChannelOrder } from '@/services/OrderSyncService';
import {
  findShippedOrdersForFulfillment,
  type ShippedFulfillmentOrder,
  type ShippedFulfillmentLine,
  type ShippedFulfillmentPacker,
} from '@/lib/zoho/fulfillment-source';
import { getFulfillmentSyncConfig, type FulfillmentSyncConfig } from '@/lib/zoho/fulfillment-config';

// ─── Ledger ──────────────────────────────────────────────────────────────────

export interface FulfillmentLedgerRecord {
  referenceNumber: string;
  channel: string | null;
  zohoSalesorderId: string | null;
  zohoPackageId: string | null;
  zohoShipmentId: string | null;
  zohoInvoiceId: string | null;
  invoiceStatus: string | null;
  stage: string;
  status: string;
  delivered: boolean;
  carrier: string | null;
  trackingNumber: string | null;
  sourceHash: string | null;
  attempts: number;
  lastError: string | null;
  dryRun: boolean;
}

export interface FulfillmentLedgerStore {
  get(referenceNumber: string): Promise<FulfillmentLedgerRecord | null>;
  save(record: FulfillmentLedgerRecord, orgId: string, completed: boolean): Promise<void>;
}

function blankLedger(order: ShippedFulfillmentOrder): FulfillmentLedgerRecord {
  return {
    referenceNumber: order.referenceNumber,
    channel: order.channel,
    zohoSalesorderId: null,
    zohoPackageId: null,
    zohoShipmentId: null,
    zohoInvoiceId: null,
    invoiceStatus: null,
    stage: 'pending',
    status: 'pending',
    delivered: false,
    carrier: order.carrier,
    trackingNumber: order.trackingNumber,
    sourceHash: order.sourceHash,
    attempts: 0,
    lastError: null,
    dryRun: false,
  };
}

/** Postgres-backed ledger (the `zoho_fulfillment_sync` table). */
export class PgFulfillmentLedger implements FulfillmentLedgerStore {
  async get(referenceNumber: string): Promise<FulfillmentLedgerRecord | null> {
    const res = await pool.query(
      `SELECT reference_number, channel, zoho_salesorder_id, zoho_package_id,
              zoho_shipment_id, zoho_invoice_id, invoice_status, stage, status,
              delivered, carrier, tracking_number, source_hash, attempts,
              last_error, dry_run
         FROM zoho_fulfillment_sync
        WHERE reference_number = $1
        LIMIT 1`,
      [referenceNumber]
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      referenceNumber: r.reference_number,
      channel: r.channel,
      zohoSalesorderId: r.zoho_salesorder_id,
      zohoPackageId: r.zoho_package_id,
      zohoShipmentId: r.zoho_shipment_id,
      zohoInvoiceId: r.zoho_invoice_id,
      invoiceStatus: r.invoice_status,
      stage: r.stage,
      status: r.status,
      delivered: r.delivered,
      carrier: r.carrier,
      trackingNumber: r.tracking_number,
      sourceHash: r.source_hash,
      attempts: r.attempts,
      lastError: r.last_error,
      dryRun: r.dry_run,
    };
  }

  async save(record: FulfillmentLedgerRecord, orgId: string, completed: boolean): Promise<void> {
    await pool.query(
      `INSERT INTO zoho_fulfillment_sync
         (organization_id, reference_number, channel, zoho_salesorder_id, zoho_package_id,
          zoho_shipment_id, zoho_invoice_id, invoice_status, stage, status, delivered,
          carrier, tracking_number, source_hash, attempts, last_error, dry_run,
          synced_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               ${completed ? 'NOW()' : 'NULL'}, NOW())
       ON CONFLICT (reference_number) DO UPDATE SET
         organization_id    = EXCLUDED.organization_id,
         channel            = EXCLUDED.channel,
         zoho_salesorder_id = EXCLUDED.zoho_salesorder_id,
         zoho_package_id    = EXCLUDED.zoho_package_id,
         zoho_shipment_id   = EXCLUDED.zoho_shipment_id,
         zoho_invoice_id    = EXCLUDED.zoho_invoice_id,
         invoice_status     = EXCLUDED.invoice_status,
         stage              = EXCLUDED.stage,
         status             = EXCLUDED.status,
         delivered          = EXCLUDED.delivered,
         carrier            = EXCLUDED.carrier,
         tracking_number    = EXCLUDED.tracking_number,
         source_hash        = EXCLUDED.source_hash,
         attempts           = EXCLUDED.attempts,
         last_error         = EXCLUDED.last_error,
         dry_run            = EXCLUDED.dry_run,
         synced_at          = ${completed ? 'NOW()' : 'zoho_fulfillment_sync.synced_at'},
         updated_at         = NOW()`,
      [
        orgId,
        record.referenceNumber,
        record.channel,
        record.zohoSalesorderId,
        record.zohoPackageId,
        record.zohoShipmentId,
        record.zohoInvoiceId,
        record.invoiceStatus,
        record.stage,
        record.status,
        record.delivered,
        record.carrier,
        record.trackingNumber,
        record.sourceHash,
        record.attempts,
        record.lastError,
        record.dryRun,
      ]
    );
  }
}

// ─── Engine ──────────────────────────────────────────────────────────────────

/** Subset of the Zoho client the engine needs — keeps the state machine testable. */
export type FulfillmentZohoClient = Pick<
  ZohoInventoryClient,
  | 'getSalesOrder'
  | 'listPackagesForSalesOrder'
  | 'createPackage'
  | 'createShipmentOrder'
  | 'markShipmentDelivered'
  | 'findInvoiceByReference'
  | 'createInvoice'
  | 'markInvoiceSent'
  | 'recordPayment'
>;

export interface FulfillmentDeps {
  client: FulfillmentZohoClient;
  ledger: FulfillmentLedgerStore;
  /** Resolve (or create+confirm) the Zoho sales order id for this order. */
  ensureSalesOrder: (order: ShippedFulfillmentOrder) => Promise<string>;
  config: FulfillmentSyncConfig;
  orgId: string;
}

export interface OrderSyncResult {
  referenceNumber: string;
  status: 'completed' | 'error' | 'skipped' | 'dry_run';
  stage: string;
  delivered: boolean;
  /** Display context (sales-channel, carrier, scanner, line items) so the UI can
   *  show exactly what each shipped/packer-scanned order pushed to Zoho. */
  channel: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  orderDate: string | null;
  deliveredAt: string | null;
  packer: ShippedFulfillmentPacker | null;
  lines: ShippedFulfillmentLine[];
  zoho: {
    salesOrderId?: string | null;
    packageId?: string | null;
    shipmentId?: string | null;
    invoiceId?: string | null;
  };
  actions: string[];
  error?: string;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Idempotently push ONE shipped order through the Zoho fulfillment chain.
 * Pure with respect to its `deps` — inject a fake client/ledger to unit-test.
 */
export async function syncOneOrder(
  order: ShippedFulfillmentOrder,
  deps: FulfillmentDeps,
  opts: { dryRun: boolean; force?: boolean }
): Promise<OrderSyncResult> {
  const { client, ledger, config, orgId } = deps;

  // Display context attached to every result (regardless of outcome) so the UI
  // can render the order's channel, scanner, tracking, and line items.
  const display = {
    channel: order.channel,
    carrier: order.carrier,
    trackingNumber: order.trackingNumber,
    orderDate: order.orderDate,
    deliveredAt: order.deliveredAt,
    packer: order.packer,
    lines: order.lines,
  };

  const existing = await ledger.get(order.referenceNumber);

  // Skip already-completed orders whose shipment snapshot hasn't changed.
  if (
    !opts.force &&
    existing?.status === 'completed' &&
    existing.sourceHash === order.sourceHash
  ) {
    return {
      referenceNumber: order.referenceNumber,
      status: 'skipped',
      stage: existing.stage,
      delivered: existing.delivered,
      ...display,
      zoho: {
        salesOrderId: existing.zohoSalesorderId,
        packageId: existing.zohoPackageId,
        shipmentId: existing.zohoShipmentId,
        invoiceId: existing.zohoInvoiceId,
      },
      actions: ['unchanged since last successful sync — skipped'],
    };
  }

  const rec: FulfillmentLedgerRecord = existing ?? blankLedger(order);
  rec.channel = order.channel;
  rec.carrier = order.carrier;
  rec.trackingNumber = order.trackingNumber;
  rec.sourceHash = order.sourceHash;
  rec.attempts += 1;
  rec.dryRun = opts.dryRun;
  const actions: string[] = [];

  // ── Dry-run: describe intended actions, touch nothing in Zoho. ──
  if (opts.dryRun) {
    actions.push(rec.zohoSalesorderId ? `reuse sales order ${rec.zohoSalesorderId}` : 'ensure sales order (create+confirm if missing)');
    actions.push(rec.zohoPackageId ? `reuse package ${rec.zohoPackageId}` : 'create package for all SO line items');
    actions.push(rec.zohoShipmentId ? `reuse shipment ${rec.zohoShipmentId}` : `create shipment (carrier ${order.carrier ?? 'n/a'}, tracking ${order.trackingNumber ?? 'n/a'})`);
    if (config.markDeliveredFromTracking && order.isDelivered) actions.push('mark shipment delivered');
    if (config.invoiceMode !== 'none') actions.push(`invoice → ${config.invoiceMode}`);
    rec.stage = 'pending';
    rec.status = 'dry_run';
    rec.lastError = null;
    await ledger.save(rec, orgId, false);
    return {
      referenceNumber: order.referenceNumber,
      status: 'dry_run',
      stage: rec.stage,
      delivered: rec.delivered,
      ...display,
      zoho: {
        salesOrderId: rec.zohoSalesorderId,
        packageId: rec.zohoPackageId,
        shipmentId: rec.zohoShipmentId,
        invoiceId: rec.zohoInvoiceId,
      },
      actions,
    };
  }

  const today = getCurrentPSTDateKey();

  try {
    // 1. Sales order ───────────────────────────────────────────────
    let soId = rec.zohoSalesorderId;
    if (!soId) {
      soId = await deps.ensureSalesOrder(order);
      rec.zohoSalesorderId = soId;
      actions.push(`ensured sales order ${soId}`);
    } else {
      actions.push(`reusing sales order ${soId}`);
    }
    rec.stage = 'salesorder';
    await ledger.save(rec, orgId, false);

    const so = await client.getSalesOrder(soId);
    const soLines = (so.line_items ?? []).filter((li) => li.line_item_id);
    if (soLines.length === 0) {
      throw new Error(`Zoho sales order ${soId} has no line items to package`);
    }

    // 2. Package ───────────────────────────────────────────────────
    let packageId = rec.zohoPackageId;
    if (!packageId) {
      const existingPkgs = await client.listPackagesForSalesOrder(soId);
      if (existingPkgs.length > 0) {
        packageId = existingPkgs[0].package_id;
        actions.push(`reusing existing package ${packageId}`);
      } else {
        const pkg = await client.createPackage(soId, {
          date: today,
          line_items: soLines.map((li) => ({
            so_line_item_id: li.line_item_id,
            quantity: num(li.quantity, 1) || 1,
          })),
          notes: `Auto-synced from internal order ${order.referenceNumber}`,
        });
        packageId = pkg.package_id;
        actions.push(`created package ${packageId}`);
      }
      rec.zohoPackageId = packageId;
    } else {
      actions.push(`reusing package ${packageId}`);
    }
    rec.stage = 'package';
    await ledger.save(rec, orgId, false);

    // 3. Shipment order ────────────────────────────────────────────
    let shipmentId = rec.zohoShipmentId;
    if (!shipmentId) {
      const shipment = await client.createShipmentOrder(soId, [packageId], {
        date: today,
        delivery_method: order.carrier ?? undefined,
        tracking_number: order.trackingNumber ?? undefined,
        reference_number: order.referenceNumber,
        notes: `Auto-synced from internal order ${order.referenceNumber}`,
      });
      shipmentId = shipment.shipment_id ?? shipment.shipmentorder_id ?? null;
      rec.zohoShipmentId = shipmentId;
      actions.push(`created shipment ${shipmentId}`);
    } else {
      actions.push(`reusing shipment ${shipmentId}`);
    }
    rec.stage = 'shipment';
    await ledger.save(rec, orgId, false);

    // 4. Delivered ─────────────────────────────────────────────────
    if (config.markDeliveredFromTracking && order.isDelivered && !rec.delivered && shipmentId) {
      await client.markShipmentDelivered(shipmentId);
      rec.delivered = true;
      actions.push('marked shipment delivered');
    }
    rec.stage = 'delivered';
    await ledger.save(rec, orgId, false);

    // 5. Invoice (accounting record) ───────────────────────────────
    if (config.invoiceMode !== 'none') {
      let invoiceId = rec.zohoInvoiceId;
      let invoiceTotal = num(so.total, 0);

      if (!invoiceId) {
        const found = await client.findInvoiceByReference(order.referenceNumber);
        if (found) {
          invoiceId = found.invoice_id;
          rec.invoiceStatus = found.status ?? rec.invoiceStatus;
          invoiceTotal = num(found.total, invoiceTotal);
          actions.push(`reusing invoice ${invoiceId}`);
        } else {
          if (!so.customer_id) throw new Error(`Sales order ${soId} has no customer_id for invoicing`);
          const created = await client.createInvoice({
            customer_id: so.customer_id,
            salesorder_id: soId,
            reference_number: order.referenceNumber,
            date: today,
            line_items: soLines.map((li) => ({
              salesorder_item_id: li.line_item_id,
              item_id: li.item_id,
              quantity: num(li.quantity, 1) || 1,
              rate: num(li.rate, 0),
              ...(li.tax_id ? { tax_id: li.tax_id } : {}),
            })),
            notes: `Auto-synced from internal order ${order.referenceNumber}`,
          });
          invoiceId = created.invoice_id;
          rec.invoiceStatus = created.status ?? 'draft';
          invoiceTotal = num(created.total, invoiceTotal);
          actions.push(`created invoice ${invoiceId}`);
        }
        rec.zohoInvoiceId = invoiceId;
      } else {
        actions.push(`reusing invoice ${invoiceId}`);
      }

      const alreadyOpen = ['sent', 'paid', 'overdue', 'partially_paid'].includes(
        String(rec.invoiceStatus ?? '').toLowerCase()
      );
      if ((config.invoiceMode === 'sent' || config.invoiceMode === 'paid') && !alreadyOpen) {
        await client.markInvoiceSent(invoiceId);
        rec.invoiceStatus = 'sent';
        actions.push('marked invoice sent');
      }

      if (config.invoiceMode === 'paid' && String(rec.invoiceStatus ?? '').toLowerCase() !== 'paid') {
        if (invoiceTotal > 0 && so.customer_id) {
          await client.recordPayment({
            customer_id: so.customer_id,
            amount: invoiceTotal,
            date: today,
            payment_mode: config.paymentMode,
            reference_number: order.referenceNumber,
            invoices: [{ invoice_id: invoiceId, amount_applied: invoiceTotal }],
          });
          rec.invoiceStatus = 'paid';
          actions.push(`recorded payment ${invoiceTotal} (invoice paid)`);
        } else {
          actions.push('payment skipped (zero/unknown invoice total)');
        }
      }
    }

    // Done.
    rec.stage = 'completed';
    rec.status = 'completed';
    rec.lastError = null;
    await ledger.save(rec, orgId, true);

    return {
      referenceNumber: order.referenceNumber,
      status: 'completed',
      stage: rec.stage,
      delivered: rec.delivered,
      ...display,
      zoho: {
        salesOrderId: rec.zohoSalesorderId,
        packageId: rec.zohoPackageId,
        shipmentId: rec.zohoShipmentId,
        invoiceId: rec.zohoInvoiceId,
      },
      actions,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rec.status = 'error';
    rec.lastError = message;
    await ledger.save(rec, orgId, false).catch(() => undefined);
    return {
      referenceNumber: order.referenceNumber,
      status: 'error',
      stage: rec.stage,
      delivered: rec.delivered,
      ...display,
      zoho: {
        salesOrderId: rec.zohoSalesorderId,
        packageId: rec.zohoPackageId,
        shipmentId: rec.zohoShipmentId,
        invoiceId: rec.zohoInvoiceId,
      },
      actions,
      error: message,
    };
  }
}

/**
 * Default sales-order resolver: local mirror → Zoho lookup → create+confirm via
 * OrderSyncService (which also creates the contact and resolves item mappings).
 */
async function defaultEnsureSalesOrder(
  order: ShippedFulfillmentOrder,
  orgId: string
): Promise<string> {
  const local = await salesOrderRepository.findByReference(order.referenceNumber);
  if (local?.zohoSoId) return local.zohoSoId;

  const existingZoho = await zohoClient.findSalesOrderByReference(order.referenceNumber);
  if (existingZoho?.salesorder_id) return existingZoho.salesorder_id;

  const channelOrder: ChannelOrder = {
    channel: order.channel,
    channelOrderId: order.referenceNumber,
    orderDate: order.orderDate ?? new Date().toISOString().slice(0, 10),
    shipmentDate: order.deliveredAt ?? undefined,
    buyer: {
      name: order.customer?.name ?? 'Customer',
      email: order.customer?.email ?? null,
      phone: order.customer?.phone ?? null,
      billingAddress: order.customer?.billingAddress ?? undefined,
      shippingAddress: order.customer?.shippingAddress ?? undefined,
    },
    items: order.lines.map((l) => ({ sku: l.sku ?? '', quantity: l.quantity })),
    billingAddress: order.customer?.billingAddress ?? undefined,
    shippingAddress: order.customer?.shippingAddress ?? undefined,
    notes: `Shipped-order fulfillment sync for ${order.referenceNumber}`,
  };

  const created = await orderSyncService.ingestExternalOrder(orgId, channelOrder);
  const soId = (created as { zohoSoId?: string | null })?.zohoSoId ?? null;
  if (!soId) {
    throw new Error(`Could not obtain Zoho sales order id for ${order.referenceNumber}`);
  }
  return soId;
}

// ─── Batch runner ────────────────────────────────────────────────────────────

export interface SyncRunOptions {
  /** Delta cursor — only orders changed at/after this time. Omit for full scan. */
  since?: Date | null;
  /** Override the dry-run decision (defaults to config.dryRunDefault). */
  dryRun?: boolean;
  /** Re-process even completed/unchanged orders. */
  force?: boolean;
  /** Cap orders processed (defaults to config.batchSize). */
  limit?: number;
  /** Process only this internal order_id. */
  referenceNumber?: string;
  /** Override individual config fields (e.g. invoiceMode for a test run). */
  config?: Partial<FulfillmentSyncConfig>;
  /** Inject deps for testing; production callers omit this. */
  deps?: Partial<FulfillmentDeps>;
}

export interface SyncRunReport {
  dryRun: boolean;
  invoiceMode: FulfillmentSyncConfig['invoiceMode'];
  scanned: number;
  completed: number;
  skipped: number;
  errored: number;
  /** Latest source change timestamp seen this run (for advancing the cursor). */
  runStartedAt: string;
  results: OrderSyncResult[];
  errors: string[];
  elapsedMs: number;
}

/**
 * Discover shipped orders (optionally since a cursor) and push each through the
 * Zoho fulfillment chain. Returns an aggregate report; the caller advances the
 * sync cursor when `errored === 0`.
 */
export async function syncShippedOrdersToZoho(opts: SyncRunOptions = {}): Promise<SyncRunReport> {
  const start = Date.now();
  const runStartedAt = new Date().toISOString();
  const config = getFulfillmentSyncConfig(opts.config);
  const dryRun = opts.dryRun ?? config.dryRunDefault;
  const orgId = opts.deps?.orgId ?? transitionalUsavOrgId();

  const deps: FulfillmentDeps = {
    client: opts.deps?.client ?? zohoClient,
    ledger: opts.deps?.ledger ?? new PgFulfillmentLedger(),
    ensureSalesOrder:
      opts.deps?.ensureSalesOrder ?? ((order) => defaultEnsureSalesOrder(order, orgId)),
    config,
    orgId,
  };

  const orders = await findShippedOrdersForFulfillment({
    since: opts.since,
    limit: opts.limit ?? config.batchSize,
    includeFba: config.includeFba,
    referenceNumber: opts.referenceNumber,
  });

  const results: OrderSyncResult[] = [];
  for (const order of orders) {
    results.push(await syncOneOrder(order, deps, { dryRun, force: opts.force }));
  }

  const errors = results.filter((r) => r.status === 'error').map((r) => `${r.referenceNumber}: ${r.error}`);

  return {
    dryRun,
    invoiceMode: config.invoiceMode,
    scanned: results.length,
    completed: results.filter((r) => r.status === 'completed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    errored: errors.length,
    runStartedAt,
    results,
    errors,
    elapsedMs: Date.now() - start,
  };
}
