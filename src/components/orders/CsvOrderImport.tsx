'use client';

// MOUNT: drop <CsvOrderImport /> into a settings/integrations surface (e.g. an
// "Import orders from CSV" card under Settings → Integrations) or behind a tab in
// the OrdersSyncPopover. Self-contained: file input → in-browser parse → mapping → POST.

import { useMemo, useState } from 'react';
import { Button } from '@/design-system/primitives';
import { EmptyState } from '@/design-system/primitives/EmptyState';
import {
  Upload,
  FileText,
  Check,
  CheckCircle,
  AlertTriangle,
  Loader2,
} from '@/components/Icons';

// ── Canonical fields ─────────────────────────────────────────────────────────
// Must match the route's CANONICAL_FIELDS. order_number is required.
const CANONICAL_FIELDS = [
  { key: 'order_number', label: 'Order number', required: true },
  { key: 'sku', label: 'SKU', required: false },
  { key: 'quantity', label: 'Quantity', required: false },
  { key: 'customer_name', label: 'Customer name', required: false },
  { key: 'tracking_number', label: 'Tracking number', required: false },
  { key: 'platform', label: 'Platform', required: false },
] as const;

type CanonicalKey = (typeof CANONICAL_FIELDS)[number]['key'];

interface ImportResult {
  inserted: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

// ── Dependency-free CSV parser ───────────────────────────────────────────────
// Handles quoted fields, escaped quotes (""), commas/newlines inside quotes, and
// both \n and \r\n line endings. Returns { headers, rows }.
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { record.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { record.push(field); records.push(record); field = ''; record = []; continue; }
    field += ch;
  }
  // Flush trailing field/record (file may not end in a newline).
  if (field.length > 0 || record.length > 0) { record.push(field); records.push(record); }

  // Drop fully-empty records (e.g. trailing blank line).
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
    return obj;
  });
  return { headers, rows };
}

// Best-effort auto-map: match a canonical key against detected headers by a
// normalized comparison (strip non-alphanumerics, lowercase).
function autoMap(headers: string[]): Record<string, string> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapping: Record<string, string> = {};
  const aliases: Record<CanonicalKey, string[]> = {
    order_number: ['ordernumber', 'orderid', 'order', 'ordno', 'orderno'],
    sku: ['sku', 'itemsku', 'productsku'],
    quantity: ['quantity', 'qty', 'count'],
    customer_name: ['customername', 'customer', 'buyer', 'buyername', 'name'],
    tracking_number: ['trackingnumber', 'tracking', 'trackingno'],
    platform: ['platform', 'channel', 'source', 'marketplace'],
  };
  for (const field of CANONICAL_FIELDS) {
    const want = aliases[field.key];
    const hit = headers.find((h) => want.includes(norm(h)));
    if (hit) mapping[field.key] = hit;
  }
  return mapping;
}

export function CsvOrderImport() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const canSubmit = useMemo(
    () => rows.length > 0 && Boolean(mapping.order_number) && !submitting,
    [rows.length, mapping.order_number, submitting],
  );

  async function handleFile(file: File) {
    setParseError(null);
    setResult(null);
    setSubmitError(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const { headers: hdrs, rows: parsedRows } = parseCsv(text);
      if (hdrs.length === 0 || parsedRows.length === 0) {
        setHeaders([]);
        setRows([]);
        setMapping({});
        setParseError('No data rows found in this file.');
        return;
      }
      setHeaders(hdrs);
      setRows(parsedRows);
      setMapping(autoMap(hdrs));
    } catch {
      setParseError('Could not read this file.');
    }
  }

  function reset() {
    setFileName(null);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setParseError(null);
    setSubmitError(null);
    setResult(null);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    setResult(null);
    try {
      const res = await fetch('/api/orders/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, mapping }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitError(json?.error || 'Import failed.');
        return;
      }
      setResult(json as ImportResult);
    } catch {
      setSubmitError('Network error — could not reach the import endpoint.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Result summary ──────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-emerald-600" />
          <h3 className="text-caption font-bold text-text-default">Import complete</h3>
        </div>
        <div className="divide-y divide-border-hairline rounded-xl border border-border-soft">
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-eyebrow font-semibold uppercase tracking-widest text-text-soft">Inserted</span>
            <span className="text-caption font-bold text-emerald-700">{result.inserted}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-eyebrow font-semibold uppercase tracking-widest text-text-soft">Skipped (duplicates)</span>
            <span className="text-caption font-bold text-text-muted">{result.skipped}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-eyebrow font-semibold uppercase tracking-widest text-text-soft">Errors</span>
            <span className="text-caption font-bold text-rose-700">{result.errors.length}</span>
          </div>
        </div>

        {result.errors.length > 0 && (
          <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-eyebrow font-black uppercase tracking-widest text-rose-700">
              <AlertTriangle className="h-3.5 w-3.5" /> Row errors
            </div>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto text-mini text-rose-700">
              {result.errors.slice(0, 50).map((e) => (
                <li key={e.row}>Row {e.row + 1}: {e.reason}</li>
              ))}
            </ul>
          </div>
        )}

        <Button variant="secondary" size="sm" icon={<Upload className="h-4 w-4" />} onClick={reset}>
          Import another file
        </Button>
      </div>
    );
  }

  // ── No file yet: teaching empty + file picker ─────────────────────────────────
  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={<FileText className="h-6 w-6 text-text-faint" />}
          title="Import orders from CSV"
          description="Upload a CSV export from any channel. You'll map its columns to order fields on the next step."
          action={
            <label className="inline-flex cursor-pointer">
              <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-label font-bold text-white shadow-sm shadow-blue-600/25 hover:bg-blue-500">
                <Upload className="h-4 w-4" /> Choose CSV file
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = '';
                }}
              />
            </label>
          }
        />
        {parseError && (
          <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-center text-mini font-semibold text-rose-700">
            {parseError}
          </div>
        )}
      </div>
    );
  }

  // ── Mapping step ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 shrink-0 text-text-soft" />
          <span className="truncate text-caption font-bold text-text-default">{fileName}</span>
          <span className="shrink-0 text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
            {rows.length} rows
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={reset}>Change file</Button>
      </div>

      <div className="space-y-3">
        <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">Map columns</p>
        <div className="divide-y divide-border-hairline rounded-xl border border-border-soft">
          {CANONICAL_FIELDS.map((field) => {
            const selected = mapping[field.key] ?? '';
            const missingRequired = field.required && !selected;
            return (
              <div key={field.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-caption font-bold text-text-default">
                    {field.label}
                    {field.required && <span className="ml-1 text-rose-600">*</span>}
                  </p>
                  <p className="text-eyebrow font-semibold uppercase tracking-widest text-text-soft">{field.key}</p>
                </div>
                <div className="flex items-center gap-2">
                  {selected && !missingRequired && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                  <select
                    value={selected}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMapping((m) => {
                        const next = { ...m };
                        if (v) next[field.key] = v; else delete next[field.key];
                        return next;
                      });
                    }}
                    className={`h-8 rounded-lg border bg-surface-card px-2 text-label font-semibold text-text-default focus:outline-none focus:ring-1 ${
                      missingRequired
                        ? 'border-rose-300 ring-rose-200'
                        : 'border-border-soft focus:border-blue-400 focus:ring-blue-400'
                    }`}
                  >
                    <option value="">— Not mapped —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {submitError && (
        <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-center text-mini font-semibold text-rose-700">
          {submitError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border-hairline pt-3">
        {!mapping.order_number && (
          <span className="text-mini font-semibold text-text-soft">Map an order number column to continue</span>
        )}
        <Button
          variant="primary"
          size="sm"
          disabled={!canSubmit}
          icon={submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          onClick={() => void handleSubmit()}
        >
          {submitting ? 'Importing…' : `Import ${rows.length} orders`}
        </Button>
      </div>
    </div>
  );
}
