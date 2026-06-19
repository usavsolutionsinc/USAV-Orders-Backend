/**
 * Data-source registry — named, typed read feeds an integration exposes to
 * the station builder. Every source wraps an EXISTING GET route; extraction
 * logic ("pull the PO# out of the email") lives server-side in the
 * integration and is exposed here as just another field.
 *
 * Adding an integration = registering its sources + actions; every existing
 * block can immediately display and act on it with zero new UI code.
 */

import type { DataSourceDefinition, DataSourceMeta, SourceRow } from './contract';

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
    return `/api/receiving-lines?view=incoming&state=AWAITING_TRACKING&limit=${limit}`;
  },
  parse: (json) => {
    const lines = (json as { receiving_lines?: Array<Record<string, unknown>> })?.receiving_lines ?? [];
    const seen = new Set<string>();
    const rows: SourceRow[] = [];
    for (const l of lines) {
      const po =
        (l.zoho_purchaseorder_number as string | null) ??
        (l.receiving_zoho_purchaseorder_number as string | null);
      // One checklist row per PO, not per line — attaching tracking is a
      // PO-level act.
      const key = po ?? `line-${l.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const zohoPoId =
        (l.zoho_purchaseorder_id as string | null) ??
        (l.receiving_zoho_purchaseorder_id as string | null) ??
        null;
      rows.push({
        id: String(l.id),
        po_number: po,
        po_id: zohoPoId,
        vendor_name: l.vendor_name ?? null,
        sku: l.sku ?? null,
        po_date: l.po_date ?? null,
      });
    }
    return rows;
  },
  shape: [
    { key: 'po_number', label: 'PO #', kind: 'po_ref' },
    { key: 'vendor_name', label: 'Vendor', kind: 'text' },
    { key: 'sku', label: 'SKU', kind: 'sku_ref' },
    { key: 'po_date', label: 'PO date', kind: 'timestamp' },
  ],
  filters: [
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

let builtinsRegistered = false;
export function registerBuiltinDataSources(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  registerDataSource(poGmailUnmatchedEmails);
  registerDataSource(receivingAwaitingTrackingPos);
  registerDataSource(sourcingOpenDemand);
}
