import test from 'node:test';
import assert from 'node:assert/strict';

import {
  syncOneOrder,
  type FulfillmentDeps,
  type FulfillmentLedgerRecord,
  type FulfillmentLedgerStore,
  type FulfillmentZohoClient,
} from './fulfillment-sync';
import type { FulfillmentSyncConfig } from './fulfillment-config';
import type { ShippedFulfillmentOrder } from './fulfillment-source';

// ── Fakes ────────────────────────────────────────────────────────────────────

class MemLedger implements FulfillmentLedgerStore {
  store = new Map<string, FulfillmentLedgerRecord>();
  async get(ref: string) {
    const r = this.store.get(ref);
    return r ? { ...r } : null;
  }
  async save(rec: FulfillmentLedgerRecord, _orgId?: string, _completed?: boolean) {
    this.store.set(rec.referenceNumber, { ...rec });
  }
}

function makeFakeClient(overrides: Partial<Record<keyof FulfillmentZohoClient, any>> = {}) {
  const calls = {
    getSalesOrder: 0,
    listPackagesForSalesOrder: 0,
    createPackage: 0,
    createShipmentOrder: 0,
    markShipmentDelivered: 0,
    findInvoiceByReference: 0,
    createInvoice: 0,
    markInvoiceSent: 0,
    recordPayment: 0,
  };
  const client: FulfillmentZohoClient = {
    async getSalesOrder(id: string) {
      calls.getSalesOrder++;
      return {
        salesorder_id: id,
        customer_id: 'CUST-1',
        total: 20,
        line_items: [{ line_item_id: 'L1', item_id: 'I1', quantity: 2, rate: 10 }],
      };
    },
    async listPackagesForSalesOrder() {
      calls.listPackagesForSalesOrder++;
      return [];
    },
    async createPackage() {
      calls.createPackage++;
      return { package_id: 'PKG-1' };
    },
    async createShipmentOrder() {
      calls.createShipmentOrder++;
      return { shipment_id: 'SHP-1' };
    },
    async markShipmentDelivered() {
      calls.markShipmentDelivered++;
    },
    async findInvoiceByReference() {
      calls.findInvoiceByReference++;
      return null;
    },
    async createInvoice() {
      calls.createInvoice++;
      return { invoice_id: 'INV-1', status: 'draft', total: 20 };
    },
    async markInvoiceSent() {
      calls.markInvoiceSent++;
    },
    async recordPayment() {
      calls.recordPayment++;
      return { payment_id: 'PAY-1' };
    },
    ...overrides,
  };
  return { client, calls };
}

const BASE_CONFIG: FulfillmentSyncConfig = {
  invoiceMode: 'sent',
  markDeliveredFromTracking: true,
  includeFba: false,
  paymentMode: 'banktransfer',
  bootstrapLookbackDays: 30,
  batchSize: 100,
  dryRunDefault: true,
};

const ORDER: ShippedFulfillmentOrder = {
  referenceNumber: 'ORD-1',
  channel: 'ebay',
  orderDate: '2026-05-01',
  carrier: 'FedEx',
  trackingNumber: 'TRK1',
  isDelivered: true,
  deliveredAt: '2026-05-03',
  changedAt: '2026-05-03 10:00:00+00',
  customer: null,
  packer: { id: 7, name: 'Pat Packer', packedAt: '2026-05-02 09:00:00+00' },
  lines: [{ sku: 'SKU1', quantity: 2, productTitle: 'Widget', itemNumber: null }],
  sourceHash: 'hash-1',
};

function makeDeps(
  client: FulfillmentZohoClient,
  ledger: FulfillmentLedgerStore,
  config: FulfillmentSyncConfig,
  ensureCalls?: { n: number }
): FulfillmentDeps {
  return {
    client,
    ledger,
    config,
    orgId: 'org-1',
    ensureSalesOrder: async () => {
      if (ensureCalls) ensureCalls.n++;
      return 'SO-1';
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('live run walks SO → package → shipment → delivered → invoice(sent)', async () => {
  const { client, calls } = makeFakeClient();
  const ledger = new MemLedger();
  const ensure = { n: 0 };
  const res = await syncOneOrder(ORDER, makeDeps(client, ledger, BASE_CONFIG, ensure), { dryRun: false });

  assert.equal(res.status, 'completed');
  assert.equal(res.zoho.salesOrderId, 'SO-1');
  assert.equal(res.zoho.packageId, 'PKG-1');
  assert.equal(res.zoho.shipmentId, 'SHP-1');
  assert.equal(res.zoho.invoiceId, 'INV-1');
  assert.equal(res.delivered, true);

  assert.equal(ensure.n, 1);
  assert.equal(calls.createPackage, 1);
  assert.equal(calls.createShipmentOrder, 1);
  assert.equal(calls.markShipmentDelivered, 1);
  assert.equal(calls.createInvoice, 1);
  assert.equal(calls.markInvoiceSent, 1);
  assert.equal(calls.recordPayment, 0); // 'sent' mode does not record payment

  const led = await ledger.get('ORD-1');
  assert.equal(led?.status, 'completed');
  assert.equal(led?.invoiceStatus, 'sent');
});

test('idempotent: unchanged completed order is skipped with no Zoho calls', async () => {
  const { client, calls } = makeFakeClient();
  const ledger = new MemLedger();
  const deps = makeDeps(client, ledger, BASE_CONFIG);

  await syncOneOrder(ORDER, deps, { dryRun: false });
  const before = { ...calls };
  const res2 = await syncOneOrder(ORDER, deps, { dryRun: false });

  assert.equal(res2.status, 'skipped');
  assert.deepEqual(calls, before); // no additional Zoho calls
});

test('changed source hash re-processes (not skipped)', async () => {
  const { client } = makeFakeClient();
  const ledger = new MemLedger();
  const deps = makeDeps(client, ledger, BASE_CONFIG);

  await syncOneOrder(ORDER, deps, { dryRun: false });
  const res2 = await syncOneOrder({ ...ORDER, sourceHash: 'hash-2' }, deps, { dryRun: false });
  assert.equal(res2.status, 'completed'); // reprocessed because snapshot changed
});

test('dry-run performs no Zoho writes', async () => {
  const { client, calls } = makeFakeClient();
  const ledger = new MemLedger();
  const res = await syncOneOrder(ORDER, makeDeps(client, ledger, BASE_CONFIG), { dryRun: true });

  assert.equal(res.status, 'dry_run');
  assert.equal(calls.createPackage, 0);
  assert.equal(calls.createShipmentOrder, 0);
  assert.equal(calls.createInvoice, 0);
  assert.ok(res.actions.length > 0);
  const led = await ledger.get('ORD-1');
  assert.equal(led?.status, 'dry_run');
});

test("invoiceMode 'paid' records a customer payment", async () => {
  const { client, calls } = makeFakeClient();
  const ledger = new MemLedger();
  const config = { ...BASE_CONFIG, invoiceMode: 'paid' as const };
  const res = await syncOneOrder(ORDER, makeDeps(client, ledger, config), { dryRun: false });

  assert.equal(res.status, 'completed');
  assert.equal(calls.markInvoiceSent, 1);
  assert.equal(calls.recordPayment, 1);
  const led = await ledger.get('ORD-1');
  assert.equal(led?.invoiceStatus, 'paid');
});

test('resumes from a partially-completed ledger without duplicating', async () => {
  const { client, calls } = makeFakeClient();
  const ledger = new MemLedger();
  // Seed: SO + package already created, then it errored before the shipment step.
  await ledger.save(
    {
      referenceNumber: 'ORD-1',
      channel: 'ebay',
      zohoSalesorderId: 'SO-1',
      zohoPackageId: 'PKG-1',
      zohoShipmentId: null,
      zohoInvoiceId: null,
      invoiceStatus: null,
      stage: 'package',
      status: 'error',
      delivered: false,
      carrier: 'FedEx',
      trackingNumber: 'TRK1',
      sourceHash: 'hash-1',
      attempts: 1,
      lastError: 'boom',
      dryRun: false,
    },
    'org-1',
    false
  );

  const ensure = { n: 0 };
  const res = await syncOneOrder(ORDER, makeDeps(client, ledger, BASE_CONFIG, ensure), { dryRun: false });

  assert.equal(res.status, 'completed');
  assert.equal(ensure.n, 0); // SO reused from ledger
  assert.equal(calls.createPackage, 0); // package reused from ledger
  assert.equal(calls.createShipmentOrder, 1); // resumed here
  assert.equal(calls.createInvoice, 1);
});

test("invoiceMode 'none' skips invoicing", async () => {
  const { client, calls } = makeFakeClient();
  const ledger = new MemLedger();
  const config = { ...BASE_CONFIG, invoiceMode: 'none' as const };
  const res = await syncOneOrder(ORDER, makeDeps(client, ledger, config), { dryRun: false });

  assert.equal(res.status, 'completed');
  assert.equal(calls.createInvoice, 0);
  assert.equal(calls.markInvoiceSent, 0);
  assert.equal(res.zoho.invoiceId, null);
});
