/**
 * Data-source registry — named, typed read feeds an integration exposes to
 * the station builder. Every source wraps an EXISTING GET route; extraction
 * logic ("pull the PO# out of the email") lives server-side in the
 * integration and is exposed here as just another field.
 *
 * Adding an integration = registering its sources + actions; every existing
 * block can immediately display and act on it with zero new UI code.
 */

import type { DataSourceDefinition, DataSourceMeta, SourceRow, FieldDef, FilterDef } from './contract';

const registry = new Map<string, DataSourceDefinition>();

export function registerDataSource(def: DataSourceDefinition): void {
  if (registry.has(def.id)) {
    throw new Error(`Station data source already registered: ${def.id}`);
  }
  registry.set(def.id, def);
}

export function getDataSource(id: string): DataSourceDefinition | undefined {
  return registry.get(id);
}

export function listDataSources(): DataSourceDefinition[] {
  return [...registry.values()];
}

export function listDataSourceMeta(): DataSourceMeta[] {
  return listDataSources().map(({ parse: _p, buildUrl: _b, ...meta }) => meta);
}

/** Test-only. */
export function __clearDataSourceRegistry(): void {
  registry.clear();
}

// ─── Builtin sources ─────────────────────────────────────────

/**
 * Unmatched PO emails (Gmail) — the po-gmail pile already extracts PO
 * candidates server-side; `po_number` is just the first candidate exposed as
 * a `po_ref` field. Rows come from the inbox + upload piles (the unresolved
 * ones); `done`/`ignore` rows are resolved and excluded.
 */
const poGmailUnmatchedEmails: DataSourceDefinition = {
  id: 'po_gmail.unmatched_emails',
  label: 'Unmatched PO emails (Gmail)',
  integration: 'po-gmail',
  endpoint: '/api/admin/po-gmail/triage',
  buildUrl: () => '/api/admin/po-gmail/triage',
  parse: (json, filters) => {
    const piles = (json as { piles?: Record<string, { items?: Array<Record<string, unknown>> }> })?.piles;
    if (!piles) return [];
    const pileFilter = typeof filters.pile === 'string' ? filters.pile : 'open';
    const pileKeys = pileFilter === 'inbox' ? ['inbox'] : pileFilter === 'upload' ? ['upload'] : ['inbox', 'upload'];
    const rows: SourceRow[] = [];
    for (const key of pileKeys) {
      for (const item of piles[key]?.items ?? []) {
        const poNumbers = Array.isArray(item.po_numbers) ? (item.po_numbers as string[]) : [];
        rows.push({
          id: String(item.id),
          email_subject: item.email_subject ?? '(no subject)',
          email_from: item.email_from ?? null,
          email_received: item.email_received ?? item.scanned_at ?? null,
          po_number: poNumbers[0] ?? null,
          pile: key,
        });
      }
    }
    const hasPo = filters.has_po_candidate;
    return hasPo === true || hasPo === 'true' ? rows.filter((r) => r.po_number != null) : rows;
  },
  shape: [
    { key: 'email_subject', label: 'Subject', kind: 'text' },
    { key: 'po_number', label: 'PO #', kind: 'po_ref' },
    { key: 'email_from', label: 'From', kind: 'text' },
    { key: 'email_received', label: 'Received', kind: 'timestamp' },
  ],
  filters: [
    { key: 'has_po_candidate', label: 'Has a PO # candidate', kind: 'boolean', default: false },
    {
      key: 'pile',
      label: 'Pile',
      kind: 'select',
      options: [
        { value: 'open', label: 'Inbox + Upload (open)' },
        { value: 'inbox', label: 'Inbox only' },
        { value: 'upload', label: 'Upload only' },
      ],
      default: 'open',
    },
  ],
  permission: 'admin.view',
};

/**
 * POs still awaiting a tracking # — tier 2 of the incoming-tracking to-do.
 * Same Checklist block, different source: this binding costing one config row
 * (not a new component) is the proof the abstraction earns its keep.
 */
const receivingAwaitingTrackingPos: DataSourceDefinition = {
  id: 'receiving.awaiting_tracking_pos',
  label: 'POs awaiting tracking # (Zoho)',
  integration: 'receiving',
  endpoint: '/api/receiving-lines',
  buildUrl: (filters) => {
    const limit = typeof filters.limit === 'string' && /^\d+$/.test(filters.limit) ? filters.limit : '50';
    const q = new URLSearchParams({ view: 'incoming', state: 'AWAITING_TRACKING', limit });
    // Universal Incoming: default to all sources; a tenant can pin to zoho/ebay.
    const inbound = typeof filters.inbound === 'string' ? filters.inbound : 'all';
    if (inbound && inbound !== 'all') q.set('inbound', inbound);
    return `/api/receiving-lines?${q.toString()}`;
  },
  parse: (json) => {
    const lines = (json as { receiving_lines?: Array<Record<string, unknown>> })?.receiving_lines ?? [];
    const seen = new Set<string>();
    const rows: SourceRow[] = [];
    for (const l of lines) {
      const po =
        (l.zoho_purchaseorder_number as string | null) ??
        (l.receiving_zoho_purchaseorder_number as string | null);
      // One checklist row per PO/order, not per line — attaching tracking is a
      // PO-level act. Universal Incoming: an eBay-only line has no PO, so key on
      // its external order id instead.
      const sourceOrderId = (l.source_order_id as string | null) ?? null;
      const key = po ?? sourceOrderId ?? `line-${l.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const zohoPoId =
        (l.zoho_purchaseorder_id as string | null) ??
        (l.receiving_zoho_purchaseorder_id as string | null) ??
        null;
      rows.push({
        id: String(l.id),
        po_number: po ?? sourceOrderId,
        // attach-box resolves a Zoho PO id OR an eBay source_order_id (plan §7.4),
        // so eBay-only rows without a Zoho id still get an attach target.
        po_id: zohoPoId ?? sourceOrderId,
        inbound_source: (l.inbound_source_type as string | null) ?? 'zoho',
        vendor_name: l.vendor_name ?? null,
        sku: l.sku ?? null,
        po_date: l.po_date ?? null,
      });
    }
    return rows;
  },
  shape: [
    { key: 'po_number', label: 'PO #', kind: 'po_ref' },
    { key: 'inbound_source', label: 'Source', kind: 'source_platform' },
    { key: 'vendor_name', label: 'Vendor', kind: 'text' },
    { key: 'sku', label: 'SKU', kind: 'sku_ref' },
    { key: 'po_date', label: 'PO date', kind: 'timestamp' },
  ],
  filters: [
    {
      key: 'inbound',
      label: 'Source',
      kind: 'select',
      options: [
        { value: 'all', label: 'All sources' },
        { value: 'zoho', label: 'Zoho' },
        { value: 'ebay', label: 'eBay' },
      ],
      default: 'all',
    },
    {
      key: 'limit',
      label: 'Max rows',
      kind: 'select',
      options: [
        { value: '25', label: '25' },
        { value: '50', label: '50' },
        { value: '100', label: '100' },
      ],
      default: '50',
    },
  ],
  permission: 'receiving.view',
};

// ─── Universal Incoming sources (plan §9.3) ──────────────────
//
// The single Incoming spine, faceted by source. All wrap the same
// GET /api/receiving-lines?view=incoming route (Phase 6 universal query) — one
// checklist row per PO/order. `account_id` has no server param, so it filters
// client-side on the resolved platform account.

/** Shared row shape for the incoming spine (one row per PO/order). */
function parseIncomingRows(json: unknown, filters: Record<string, unknown>): SourceRow[] {
  const lines = (json as { receiving_lines?: Array<Record<string, unknown>> })?.receiving_lines ?? [];
  const accountFilter = typeof filters.account_id === 'string' && filters.account_id.trim() ? filters.account_id.trim() : null;
  const seen = new Set<string>();
  const rows: SourceRow[] = [];
  for (const l of lines) {
    const po = (l.zoho_purchaseorder_number as string | null) ?? null;
    const sourceOrderId = (l.source_order_id as string | null) ?? null;
    const accountId = l.platform_account_id != null ? String(l.platform_account_id) : null;
    if (accountFilter && accountId !== accountFilter) continue;
    const key = po ?? sourceOrderId ?? `line-${l.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: String(l.id),
      po_number: po ?? sourceOrderId,
      po_id: (l.zoho_purchaseorder_id as string | null) ?? sourceOrderId,
      inbound_source: (l.inbound_source_type as string | null) ?? 'zoho',
      account_label: (l.platform_account_label as string | null) ?? null,
      vendor_name: (l.vendor_name as string | null) ?? null,
      seller_name: (l.vendor_name as string | null) ?? null,
      sku: (l.sku as string | null) ?? null,
      tracking_number: (l.tracking_number as string | null) ?? null,
      po_date: (l.po_date as string | null) ?? null,
    });
  }
  return rows;
}

const INCOMING_SHAPE: FieldDef[] = [
  { key: 'po_number', label: 'PO / order #', kind: 'po_ref' },
  { key: 'inbound_source', label: 'Source', kind: 'source_platform' },
  { key: 'account_label', label: 'Account', kind: 'text' },
  { key: 'vendor_name', label: 'Vendor / seller', kind: 'text' },
  { key: 'sku', label: 'SKU', kind: 'sku_ref' },
  { key: 'tracking_number', label: 'Tracking', kind: 'tracking_ref' },
  { key: 'po_date', label: 'PO date', kind: 'timestamp' },
];

const LIMIT_FILTER: FilterDef = {
  key: 'limit',
  label: 'Max rows',
  kind: 'select',
  options: [
    { value: '25', label: '25' },
    { value: '50', label: '50' },
    { value: '100', label: '100' },
  ],
  default: '50',
};

/** Incoming POs across all sources (Zoho + eBay + …). */
const receivingIncomingAll: DataSourceDefinition = {
  id: 'receiving.incoming_all',
  label: 'Incoming POs (all sources)',
  integration: 'receiving',
  endpoint: '/api/receiving-lines',
  buildUrl: (filters) => {
    const limit = typeof filters.limit === 'string' && /^\d+$/.test(filters.limit) ? filters.limit : '50';
    const q = new URLSearchParams({ view: 'incoming', limit });
    const inbound = typeof filters.inbound === 'string' ? filters.inbound : 'all';
    if (inbound && inbound !== 'all') q.set('inbound', inbound);
    const state = typeof filters.state === 'string' ? filters.state.trim() : '';
    if (state) q.set('state', state);
    return `/api/receiving-lines?${q.toString()}`;
  },
  parse: parseIncomingRows,
  shape: INCOMING_SHAPE,
  filters: [
    {
      key: 'inbound',
      label: 'Source',
      kind: 'select',
      options: [
        { value: 'all', label: 'All sources' },
        { value: 'zoho', label: 'Zoho' },
        { value: 'ebay', label: 'eBay' },
      ],
      default: 'all',
    },
    { key: 'account_id', label: 'Buyer account id', kind: 'text' },
    LIMIT_FILTER,
  ],
  permission: 'receiving.view',
  realtime: { ablyChannel: 'receiving' },
};

/** Incoming POs from Zoho only (the legacy Incoming set). */
const receivingIncomingZoho: DataSourceDefinition = {
  id: 'receiving.incoming_zoho',
  label: 'Incoming POs (Zoho)',
  integration: 'receiving',
  endpoint: '/api/receiving-lines',
  buildUrl: (filters) => {
    const limit = typeof filters.limit === 'string' && /^\d+$/.test(filters.limit) ? filters.limit : '50';
    const q = new URLSearchParams({ view: 'incoming', inbound: 'zoho', limit });
    const state = typeof filters.state === 'string' ? filters.state.trim() : '';
    if (state) q.set('state', state);
    return `/api/receiving-lines?${q.toString()}`;
  },
  parse: parseIncomingRows,
  shape: INCOMING_SHAPE,
  filters: [LIMIT_FILTER],
  permission: 'receiving.view',
  realtime: { ablyChannel: 'receiving' },
};

/** Incoming purchases from eBay buyer accounts. */
const receivingIncomingEbay: DataSourceDefinition = {
  id: 'receiving.incoming_ebay',
  label: 'Incoming purchases (eBay)',
  integration: 'receiving',
  endpoint: '/api/receiving-lines',
  buildUrl: (filters) => {
    const limit = typeof filters.limit === 'string' && /^\d+$/.test(filters.limit) ? filters.limit : '50';
    const q = new URLSearchParams({ view: 'incoming', inbound: 'ebay', limit });
    if (filters.link === 'zoho_pending') q.set('link', 'zoho_pending');
    const state = typeof filters.state === 'string' ? filters.state.trim() : '';
    if (state) q.set('state', state);
    return `/api/receiving-lines?${q.toString()}`;
  },
  parse: parseIncomingRows,
  shape: INCOMING_SHAPE,
  filters: [
    {
      key: 'link',
      label: 'Zoho link',
      kind: 'select',
      options: [
        { value: 'any', label: 'Any' },
        { value: 'zoho_pending', label: 'Awaiting Zoho PO' },
      ],
      default: 'any',
    },
    { key: 'account_id', label: 'Buyer account id', kind: 'text' },
    LIMIT_FILTER,
  ],
  permission: 'receiving.view',
  realtime: { ablyChannel: 'receiving' },
};

/** eBay purchases still needing their Zoho PO — the merge to-do (§6.2). */
const receivingAwaitingZohoLink: DataSourceDefinition = {
  id: 'receiving.awaiting_zoho_link',
  label: 'eBay purchases needing a Zoho PO',
  integration: 'receiving',
  endpoint: '/api/receiving-lines',
  buildUrl: (filters) => {
    const limit = typeof filters.limit === 'string' && /^\d+$/.test(filters.limit) ? filters.limit : '50';
    return `/api/receiving-lines?view=incoming&inbound=ebay&link=zoho_pending&limit=${limit}`;
  },
  parse: parseIncomingRows,
  shape: INCOMING_SHAPE,
  filters: [
    { key: 'account_id', label: 'Buyer account id', kind: 'text' },
    LIMIT_FILTER,
  ],
  permission: 'receiving.view',
  realtime: { ablyChannel: 'receiving' },
};

/**
 * Open sourcing demand — the unified sourcing queue (Sourcing Hub) as a station
 * feed. Wraps GET /api/sourcing/alerts; a buyer's station can bind a Checklist
 * to it to work the queue. `?status` is server-side (buildUrl); the default
 * `live` is the route's open+sourcing set.
 */
const sourcingOpenDemand: DataSourceDefinition = {
  id: 'sourcing.open_demand',
  label: 'Sourcing queue (open demand)',
  integration: 'sourcing',
  endpoint: '/api/sourcing/alerts',
  buildUrl: (filters) => {
    const status = typeof filters.status === 'string' ? filters.status : 'live';
    // 'live' (open+sourcing) is the route default — pass no param for it.
    return status && status !== 'live'
      ? `/api/sourcing/alerts?status=${encodeURIComponent(status)}`
      : '/api/sourcing/alerts';
  },
  parse: (json) => {
    const items = (json as { items?: Array<Record<string, unknown>> })?.items ?? [];
    return items.map((a) => ({
      id: String(a.id),
      title:
        (a.product_title as string | null) ??
        (a.sku as string | null) ??
        (a.search_query as string | null) ??
        `SKU #${a.sku_id ?? '—'}`,
      sku: (a.sku as string | null) ?? null,
      alert_type: (a.alert_type as string | null) ?? null,
      severity: (a.severity as string | null) ?? null,
      demand_source: (a.demand_source as string | null) ?? null,
      opened_at: (a.opened_at as string | null) ?? null,
    }));
  },
  shape: [
    { key: 'title', label: 'Item', kind: 'text' },
    { key: 'sku', label: 'SKU', kind: 'sku_ref' },
    { key: 'demand_source', label: 'Demand', kind: 'text' },
    { key: 'alert_type', label: 'Type', kind: 'text' },
    { key: 'severity', label: 'Severity', kind: 'text' },
    { key: 'opened_at', label: 'Opened', kind: 'timestamp' },
  ],
  filters: [
    {
      key: 'status',
      label: 'Status',
      kind: 'select',
      options: [
        { value: 'live', label: 'Open (live)' },
        { value: 'resolved', label: 'Resolved' },
        { value: 'dismissed', label: 'Dismissed' },
      ],
      default: 'live',
    },
  ],
  permission: 'sourcing.view',
};

/**
 * Cartons arrived but not yet unboxed — the Unbox surface's work queue.
 * Wraps GET /api/receiving/pending-unboxing (one row per receiving carton).
 * A `rail_feed` or `checklist` block bound to this IS the unbox queue; a
 * `scan_band` in the trigger slot classifies a scan against it.
 */
const receivingUnboxQueue: DataSourceDefinition = {
  id: 'receiving.unbox_queue',
  label: 'Cartons awaiting unbox',
  integration: 'receiving',
  endpoint: '/api/receiving/pending-unboxing',
  buildUrl: (filters) => {
    const limit = typeof filters.limit === 'string' && /^\d+$/.test(filters.limit) ? filters.limit : '100';
    const status = typeof filters.status === 'string' ? filters.status : '';
    const q = new URLSearchParams({ limit });
    if (status && status !== 'ARRIVED_MATCHED') q.set('status', status);
    return `/api/receiving/pending-unboxing?${q.toString()}`;
  },
  parse: (json) => {
    const pending = (json as { pending?: Array<Record<string, unknown>> })?.pending ?? [];
    return pending.map((p) => {
      const firstLine = Array.isArray(p.lines) && p.lines.length > 0
        ? (p.lines[0] as Record<string, unknown>)
        : null;
      const title =
        (firstLine?.item_name as string | null) ??
        (p.tracking_number as string | null) ??
        `Carton #${p.receiving_id}`;
      return {
        id: String(p.receiving_id),
        title,
        tracking_number: (p.tracking_number as string | null) ?? null,
        carrier: (p.carrier as string | null) ?? null,
        po_number: (firstLine?.zoho_purchaseorder_id as string | null) ?? null,
        sku: (firstLine?.sku as string | null) ?? null,
        line_count: Number(p.line_count ?? 0),
        received_at: (p.received_at as string | null) ?? null,
      };
    });
  },
  shape: [
    { key: 'title', label: 'Item / tracking', kind: 'text' },
    { key: 'tracking_number', label: 'Tracking', kind: 'tracking_ref' },
    { key: 'carrier', label: 'Carrier', kind: 'text' },
    { key: 'po_number', label: 'PO #', kind: 'po_ref' },
    { key: 'sku', label: 'SKU', kind: 'sku_ref' },
    { key: 'received_at', label: 'Received', kind: 'timestamp' },
  ],
  filters: [
    {
      key: 'status',
      label: 'Queue',
      kind: 'select',
      options: [
        { value: 'ARRIVED_MATCHED', label: 'Arrived + matched' },
        { value: 'ALL', label: 'All pending' },
        { value: 'UNBOXED', label: 'Unboxed (recent)' },
      ],
      default: 'ARRIVED_MATCHED',
    },
    {
      key: 'limit',
      label: 'Max rows',
      kind: 'select',
      options: [
        { value: '50', label: '50' },
        { value: '100', label: '100' },
        { value: '200', label: '200' },
      ],
      default: '100',
    },
  ],
  permission: 'receiving.view',
  realtime: { ablyChannel: 'receiving' },
};

/**
 * Units awaiting test / ready-to-ship — the Test surface's work queue
 * (operator-surfaces refactor Phase 13). Wraps GET /api/inbox/tech-queue (one
 * row per carton: returns pending a test verdict + unboxed priority orders ready
 * to ship). A `rail_feed` block bound to this IS the testing queue; a `scan_band`
 * with `surface: 'test'` in the trigger slot drives the scan loop against it.
 */
const testingTechQueue: DataSourceDefinition = {
  id: 'testing.tech_queue',
  label: 'Units awaiting test / ship',
  integration: 'tech',
  endpoint: '/api/inbox/tech-queue',
  // The route takes no query params — it derives the queue from the session org.
  buildUrl: () => '/api/inbox/tech-queue',
  parse: (json) => {
    const items = (json as { items?: Array<Record<string, unknown>> })?.items ?? [];
    return items.map((it) => {
      const receivingId = it.receivingId;
      const lineId = it.lineId ?? 0;
      return {
        id: `${receivingId}-${lineId}`,
        title:
          (it.productTitle as string | null) ??
          (it.orderNumber as string | null) ??
          (it.trackingNumber as string | null) ??
          `Carton #${receivingId}`,
        tracking_number: (it.trackingNumber as string | null) ?? null,
        order_number: (it.orderNumber as string | null) ?? null,
        queue_kind:
          it.kind === 'return_pending_test' ? 'Return · needs test' : 'Order · ready to ship',
        unboxed_at: (it.unboxedAt as string | null) ?? null,
      };
    });
  },
  shape: [
    { key: 'title', label: 'Item', kind: 'text' },
    { key: 'tracking_number', label: 'Tracking', kind: 'tracking_ref' },
    { key: 'order_number', label: 'Order', kind: 'order_ref' },
    { key: 'queue_kind', label: 'Queue', kind: 'text' },
    { key: 'unboxed_at', label: 'Unboxed', kind: 'timestamp' },
  ],
  permission: 'tech.view',
  realtime: { ablyChannel: 'tech' },
};

/**
 * Open (unshipped) eBay orders — the ship bench's work queue. Wraps the
 * existing eBay orders reader GET /api/ebay/search (orders with a non-null
 * account_source, newest first). `account`/`status` are server-side params;
 * "unshipped only" filters client-side on the route's `is_shipped` flag (no
 * server param exists for it). Bind `shipstation.rate_shop` /
 * `shipstation.buy_label` to work a row, `ebay.sync_now` to re-pull the feed.
 */
const ebayOpenOrders: DataSourceDefinition = {
  id: 'ebay.open_orders',
  label: 'Open eBay orders',
  integration: 'ebay',
  endpoint: '/api/ebay/search',
  buildUrl: (filters) => {
    const limit = typeof filters.limit === 'string' && /^\d+$/.test(filters.limit) ? filters.limit : '50';
    const q = new URLSearchParams({ limit });
    if (typeof filters.account === 'string' && filters.account.trim()) q.set('account', filters.account.trim());
    return `/api/ebay/search?${q.toString()}`;
  },
  parse: (json, filters) => {
    const orders = (json as { orders?: Array<Record<string, unknown>> })?.orders ?? [];
    const openOnly = !(filters.open_only === false || filters.open_only === 'false');
    const rows: SourceRow[] = [];
    for (const o of orders) {
      if (openOnly && o.is_shipped === true) continue;
      rows.push({
        id: String(o.id),
        title: (o.product_title as string | null) ?? `Order ${o.order_id ?? o.id}`,
        order_number: (o.order_id as string | null) ?? null,
        sku: (o.sku as string | null) ?? null,
        account: (o.account_source as string | null) ?? null,
        tracking_number: (o.tracking_number as string | null) ?? null,
        ship_by_date: (o.ship_by_date as string | null) ?? null,
        order_date: (o.order_date as string | null) ?? null,
      });
    }
    return rows;
  },
  shape: [
    { key: 'title', label: 'Item', kind: 'text' },
    { key: 'order_number', label: 'Order #', kind: 'order_ref' },
    { key: 'sku', label: 'SKU', kind: 'sku_ref' },
    // `account` is a per-org eBay account name (e.g. 'usav_main'), not a
    // source-platform slug — render as plain text, not the platform chip.
    { key: 'account', label: 'Account', kind: 'text' },
    { key: 'tracking_number', label: 'Tracking', kind: 'tracking_ref' },
    { key: 'order_date', label: 'Ordered', kind: 'timestamp' },
  ],
  filters: [
    { key: 'open_only', label: 'Unshipped only', kind: 'boolean', default: true },
    { key: 'account', label: 'eBay account', kind: 'text' },
    LIMIT_FILTER,
  ],
  permission: 'orders.view',
};

let builtinsRegistered = false;
export function registerBuiltinDataSources(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  registerDataSource(poGmailUnmatchedEmails);
  registerDataSource(receivingAwaitingTrackingPos);
  registerDataSource(receivingIncomingAll);
  registerDataSource(receivingIncomingZoho);
  registerDataSource(receivingIncomingEbay);
  registerDataSource(receivingAwaitingZohoLink);
  registerDataSource(sourcingOpenDemand);
  registerDataSource(receivingUnboxQueue);
  registerDataSource(testingTechQueue);
  registerDataSource(ebayOpenOrders);
}
