'use client';

/**
 * Carton add popover — one `+` entry point for every "add" a carton supports,
 * presented as tabs. Mirrors the EcwidProductSearchPopover chrome (portal +
 * backdrop + centered card) so it reads identically to the old per-action
 * popovers it unifies.
 *
 * Tabs (a caller passes the subset that applies to the carton):
 *   • Item — search the INTERNAL catalog (Zoho `items`) and add a line. This is
 *            the surface that used to say "internal"; it's now an explicit tab.
 *   • Web  — search eBay Browse (external/secondary market) and add a line from
 *            a web hit (title + image, no SKU).
 *   • Box  — mint or pick a handling unit (`H-{id}` LPN) and drop the carton's
 *            serial units into it, then print the box label.
 *
 * Item/Web add a receiving LINE, so they only make sense for unmatched cartons.
 * Box groups already-scanned units and applies to any carton.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ExternalLink, Loader2, Package, Plus, Search, X } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { printHandlingUnitLabel } from '@/lib/print/printHandlingUnitLabel';
import { toast } from '@/lib/toast';
import { microBadge } from '@/design-system/tokens/typography/presets';

// ─── Shared types ────────────────────────────────────────────────────────────

export type CartonAddTab = 'item' | 'web' | 'box';

export interface AssignedBox {
  id: number;
  code: string;
  total: number;
  locationName: string | null;
}

/** A product chosen from the Item or Web tab — shaped for add-unmatched-line. */
export interface CartonAddSelection {
  sku_platform_id_row: number | null;
  sku_catalog_id: number | null;
  sku: string;
  item_name: string;
  image_url: string | null;
}

interface CartonAddPopoverProps {
  /** Which tabs to show (in order). Single-tab → the tab bar is hidden. */
  tabs: CartonAddTab[];
  initialTab?: CartonAddTab;
  /** Serial-unit ids (the whole carton) for the Box tab. */
  unitIds: number[];
  /** Add a catalog/web line. Required when 'item' or 'web' is in `tabs`. */
  onAddLine?: (sel: CartonAddSelection) => Promise<void>;
  /**
   * When set, the Item/Web tabs render this reason instead of their search UI.
   * Used when adding lines isn't possible at all.
   */
  addLineDisabledReason?: string | null;
  /**
   * Optional banner shown atop the Item/Web tabs — e.g. "Adds as an off-PO
   * item" on a matched carton, so the operator knows it won't hit the Zoho PO.
   */
  addLineHint?: string | null;
  /** Report the box the carton's units landed in (Box tab). */
  onAssignedBox?: (box: AssignedBox) => void;
  onClose: () => void;
}

const TAB_META: Record<CartonAddTab, { label: string; Icon: typeof Package }> = {
  item: { label: 'Item', Icon: Search },
  web: { label: 'Web', Icon: ExternalLink },
  box: { label: 'Box', Icon: Package },
};

const DEBOUNCE_MS = 220;

// ─── Component ───────────────────────────────────────────────────────────────

export function CartonAddPopover({
  tabs,
  initialTab,
  unitIds,
  onAddLine,
  addLineDisabledReason,
  addLineHint,
  onAssignedBox,
  onClose,
}: CartonAddPopoverProps) {
  const [tab, setTab] = useState<CartonAddTab>(initialTab && tabs.includes(initialTab) ? initialTab : tabs[0]!);

  // ─── Escape closes ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="carton-add-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-panelPopover bg-gray-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="carton-add-dialog"
        role="dialog"
        aria-label="Add to carton"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-none fixed inset-0 z-panelPopover flex items-start justify-center p-4 pt-[8vh] md:pl-[360px]"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl ring-1 ring-gray-200"
        >
          {/* Header: tab segment + close */}
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
            {tabs.length > 1 ? (
              <div className="flex gap-1">
                {tabs.map((t) => {
                  const { label, Icon } = TAB_META[t];
                  const active = t === tab;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-mini font-bold uppercase tracking-wider transition-colors ${
                        active
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className={`${microBadge} flex items-center gap-1.5 text-gray-700`}>
                {(() => {
                  const { label, Icon } = TAB_META[tab];
                  return (
                    <>
                      <Icon className="h-3.5 w-3.5 text-gray-500" />
                      Add to {label.toLowerCase()}
                    </>
                  );
                })()}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1 flex-col">
            {tab === 'item' ? (
              addLineDisabledReason ? (
                <DisabledNote reason={addLineDisabledReason} />
              ) : onAddLine ? (
                <ItemTab onAddLine={onAddLine} hint={addLineHint} />
              ) : null
            ) : null}
            {tab === 'web' ? (
              addLineDisabledReason ? (
                <DisabledNote reason={addLineDisabledReason} />
              ) : onAddLine ? (
                <WebTab onAddLine={onAddLine} hint={addLineHint} />
              ) : null
            ) : null}
            {tab === 'box' ? (
              <BoxTab unitIds={unitIds} onAssigned={onAssignedBox} onClose={onClose} />
            ) : null}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

// ─── Item tab — internal catalog (Zoho items) ────────────────────────────────

interface CatalogItem {
  id: number;
  sku: string | null;
  zoho_sku?: string | null;
  product_title: string;
  image_url: string | null;
}

function ItemTab({
  onAddLine,
  hint,
}: {
  onAddLine: (sel: CartonAddSelection) => Promise<void>;
  hint?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<number | 'manual' | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (manualMode) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setItems([]);
      setError(null);
      setLoading(false);
      abortRef.current?.abort();
      return;
    }
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      const url = new URL('/api/sku-catalog/search', window.location.origin);
      url.searchParams.set('q', trimmed);
      url.searchParams.set('searchField', 'zoho_catalog');
      url.searchParams.set('limit', '20');
      fetch(url.toString(), { signal: controller.signal })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as {
            success?: boolean;
            items?: CatalogItem[];
            error?: string;
          };
          if (!res.ok || !body.success) throw new Error(body.error ?? `search failed (${res.status})`);
          setItems(body.items ?? []);
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === 'AbortError') return;
          setItems([]);
          setError(err instanceof Error ? err.message : 'search failed');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, manualMode]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const pick = useCallback(
    async (item: CatalogItem) => {
      const displaySku = item.sku ?? item.zoho_sku ?? '';
      if (!displaySku && !item.product_title) return;
      setSubmitting(item.id);
      try {
        await onAddLine({
          sku_platform_id_row: null,
          sku_catalog_id: item.id,
          sku: displaySku,
          item_name: item.product_title,
          image_url: item.image_url,
        });
      } finally {
        setSubmitting(null);
      }
    },
    [onAddLine],
  );

  const submitManual = useCallback(async () => {
    const trimmed = manualTitle.trim();
    if (!trimmed || submitting != null) return;
    setSubmitting('manual');
    try {
      await onAddLine({
        sku_platform_id_row: null,
        sku_catalog_id: null,
        sku: '',
        item_name: trimmed,
        image_url: null,
      });
    } finally {
      setSubmitting(null);
    }
  }, [manualTitle, onAddLine, submitting]);

  return (
    <>
      {hint ? <HintBanner text={hint} /> : null}
      <div className="border-b border-gray-50 px-2 pb-2 pt-2">
        <span className={`${microBadge} mb-1.5 block px-1 text-gray-400`}>Internal catalog</span>
        {manualMode ? (
          <div className="flex items-center gap-2 px-1">
            <input
              autoFocus
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitManual();
              }}
              placeholder="Type a product title…"
              className="flex-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-label outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => void submitManual()}
              disabled={!manualTitle.trim() || submitting != null}
              className="rounded-md bg-blue-600 px-2.5 py-1.5 text-mini font-bold uppercase tracking-wider text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting === 'manual' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
            </button>
          </div>
        ) : (
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search product name or SKU…"
            autoFocus
            isSearching={loading}
            variant="blue"
          />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-label text-amber-800">{error}</div>
        ) : !manualMode && items.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.id}>
                <ResultRow
                  title={item.product_title}
                  subtitle={item.sku ?? item.zoho_sku ?? ''}
                  imageUrl={item.image_url}
                  busy={submitting === item.id}
                  disabled={submitting != null}
                  onClick={() => void pick(item)}
                />
              </li>
            ))}
          </ul>
        ) : !manualMode && query.trim() && !loading ? (
          <p className="px-2 py-3 text-label text-gray-400">No catalog matches.</p>
        ) : null}
      </div>
      <div className="border-t border-gray-100 px-3 py-2">
        <button
          type="button"
          onClick={() => {
            setManualMode((m) => !m);
            setManualTitle('');
          }}
          className="text-mini font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900"
        >
          {manualMode ? '← Back to catalog search' : 'Product not in catalog? Add by title'}
        </button>
      </div>
    </>
  );
}

// ─── Web tab — eBay Browse (external) ────────────────────────────────────────

interface WebHit {
  externalId: string | null;
  title: string;
  url: string | null;
  imageUrl: string | null;
  condition: 'new' | 'refurbished' | 'used' | 'for_parts' | null;
  priceCents: number | null;
}

function WebTab({
  onAddLine,
  hint,
}: {
  onAddLine: (sel: CartonAddSelection) => Promise<void>;
  hint?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<WebHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await fetch('/api/sourcing/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, limit: 20 }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        results?: WebHit[];
        error?: string;
      };
      if (!res.ok || !body.success) throw new Error(body.error ?? `search failed (${res.status})`);
      setHits(body.results ?? []);
    } catch (err) {
      setHits([]);
      setError(err instanceof Error ? err.message : 'search failed');
    } finally {
      setLoading(false);
    }
  }, [query, loading]);

  const pick = useCallback(
    async (hit: WebHit, idx: number) => {
      if (submitting != null) return;
      const key = hit.externalId ?? `idx-${idx}`;
      setSubmitting(key);
      try {
        // Web hits have no internal SKU — add as a title-only line (image kept).
        await onAddLine({
          sku_platform_id_row: null,
          sku_catalog_id: null,
          sku: '',
          item_name: hit.title,
          image_url: hit.imageUrl,
        });
      } finally {
        setSubmitting(null);
      }
    },
    [onAddLine, submitting],
  );

  return (
    <>
      {hint ? <HintBanner text={hint} /> : null}
      <div className="border-b border-gray-50 px-2 pb-2 pt-2">
        <span className={`${microBadge} mb-1.5 block px-1 text-gray-400`}>eBay / web</span>
        <SearchBar
          value={query}
          onChange={setQuery}
          onSearch={() => void runSearch()}
          placeholder="Search the web for this product…"
          autoFocus
          isSearching={loading}
          variant="purple"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-label text-amber-800">{error}</div>
        ) : hits.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {hits.map((hit, idx) => (
              <li key={hit.externalId ?? idx}>
                <ResultRow
                  title={hit.title}
                  subtitle={[
                    hit.condition ? hit.condition.replace('_', ' ') : null,
                    hit.priceCents != null ? `$${(hit.priceCents / 100).toFixed(2)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  imageUrl={hit.imageUrl}
                  busy={submitting === (hit.externalId ?? `idx-${idx}`)}
                  disabled={submitting != null}
                  onClick={() => void pick(hit, idx)}
                />
              </li>
            ))}
          </ul>
        ) : searched && !loading ? (
          <p className="px-2 py-3 text-label text-gray-400">No web results.</p>
        ) : (
          <p className="px-2 py-3 text-label text-gray-400">Type a query and press Enter to search eBay.</p>
        )}
      </div>
    </>
  );
}

// ─── Box tab — handling unit (LPN) ───────────────────────────────────────────

interface OpenBox {
  id: number;
  code: string;
  location_name: string | null;
  unit_count: number;
}

/**
 * Friendly message from a handling-unit API failure. `withAuth` serializes a
 * 500 as `{ error: 'INTERNAL', message }`, so the bare `error` code reads as
 * "INTERNAL" to operators — almost always the unapplied migration. Prefer the
 * `message`, demote the raw code, and hint at the real cause on a 500.
 */
function boxApiError(
  body: { error?: string; message?: string },
  status: number,
): string {
  if (body.message) return body.message;
  if (status >= 500 || body.error === 'INTERNAL') {
    return 'Handling-units table not ready — apply the 2026-06-08 migration.';
  }
  return body.error || `request failed (${status})`;
}

function printBoxLabel(box: AssignedBox) {
  printHandlingUnitLabel({
    handlingUnitId: box.id,
    code: box.code,
    unitCount: box.total,
    locationName: box.locationName,
    date: new Date().toLocaleDateString(),
  });
}

function BoxTab({
  unitIds,
  onAssigned,
  onClose,
}: {
  unitIds: number[];
  onAssigned?: (box: AssignedBox) => void;
  onClose: () => void;
}) {
  const [openBoxes, setOpenBoxes] = useState<OpenBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | 'new' | null>(null);

  const idemSuffix = useMemo(() => [...unitIds].sort((a, b) => a - b).join('-'), [unitIds]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/handling-units?status=OPEN&limit=50')
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          handling_units?: OpenBox[];
          error?: string;
          message?: string;
        };
        if (!res.ok || !body.success) throw new Error(boxApiError(body, res.status));
        if (!cancelled) setOpenBoxes(body.handling_units ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load boxes');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = useCallback(
    (box: AssignedBox, count: number) => {
      toast.success(`Added ${count} ${count === 1 ? 'unit' : 'units'} to ${box.code}`);
      printBoxLabel(box);
      onAssigned?.(box);
      onClose();
    },
    [onAssigned, onClose],
  );

  const mintNew = useCallback(async () => {
    if (busyId != null || unitIds.length === 0) return;
    setBusyId('new');
    try {
      const res = await fetch('/api/handling-units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ units: unitIds, idempotencyKey: `hu-mint-carton-${idemSuffix}` }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        message?: string;
        handling_unit?: { id: number; code: string; location_name?: string | null; rollup?: { total?: number } };
      };
      if (!res.ok || !json.success || !json.handling_unit) throw new Error(boxApiError(json, res.status));
      const hu = json.handling_unit;
      finish(
        { id: hu.id, code: hu.code, total: hu.rollup?.total ?? unitIds.length, locationName: hu.location_name ?? null },
        hu.rollup?.total ?? unitIds.length,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not mint box');
      setBusyId(null);
    }
  }, [busyId, unitIds, idemSuffix, finish]);

  const assignExisting = useCallback(
    async (target: OpenBox) => {
      if (busyId != null || unitIds.length === 0) return;
      setBusyId(target.id);
      try {
        const res = await fetch(`/api/handling-units/${target.id}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ units: unitIds, idempotencyKey: `hu-assign-${target.id}-${idemSuffix}` }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          message?: string;
          handling_unit?: { id: number; code: string; location_name?: string | null; rollup?: { total?: number } };
        };
        if (!res.ok || !json.success || !json.handling_unit) throw new Error(boxApiError(json, res.status));
        const hu = json.handling_unit;
        finish(
          { id: hu.id, code: hu.code, total: hu.rollup?.total ?? target.unit_count + unitIds.length, locationName: hu.location_name ?? null },
          unitIds.length,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not assign units');
        setBusyId(null);
      }
    },
    [busyId, unitIds, idemSuffix, finish],
  );

  const noUnits = unitIds.length === 0;

  return (
    <>
      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={() => void mintNew()}
          disabled={busyId != null || noUnits}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-3 py-2.5 text-label font-bold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busyId === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          New box &amp; print label · {unitIds.length} {unitIds.length === 1 ? 'unit' : 'units'}
        </button>
        {noUnits ? (
          <p className="mt-1.5 text-center text-micro text-gray-400">
            Scan a serial first — a box groups the carton&apos;s units.
          </p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <p className="mb-1.5 text-eyebrow font-black uppercase tracking-widest text-gray-400">Or add to an open box</p>
        {loading ? (
          <div className="flex h-20 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-label text-amber-800">{error}</div>
        ) : openBoxes.length === 0 ? (
          <p className="px-1 py-2 text-label text-gray-400">No open boxes yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {openBoxes.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => void assignExisting(b)}
                  disabled={busyId != null || noUnits}
                  className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left transition-colors hover:border-teal-300 hover:bg-teal-50/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Package className="h-4 w-4 shrink-0 text-teal-600" />
                  <span className="flex-1 truncate text-label font-bold text-gray-900">{b.code}</span>
                  <span className="text-micro font-semibold uppercase tracking-wider text-gray-500">
                    {b.unit_count} {b.unit_count === 1 ? 'unit' : 'units'}
                    {b.location_name ? ` · ${b.location_name}` : ''}
                  </span>
                  {busyId === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ─── Hint banner (e.g. off-PO notice) ────────────────────────────────────────

function HintBanner({ text }: { text: string }) {
  return (
    <div className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-micro font-semibold text-amber-800">
      {text}
    </div>
  );
}

// ─── Disabled tab note ───────────────────────────────────────────────────────

function DisabledNote({ reason }: { reason: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <Package className="h-6 w-6 text-gray-300" />
      <p className="max-w-xs text-label text-gray-500">{reason}</p>
    </div>
  );
}

// ─── Shared result row ───────────────────────────────────────────────────────

function ResultRow({
  title,
  subtitle,
  imageUrl,
  busy,
  disabled,
  onClick,
}: {
  title: string;
  subtitle: string;
  imageUrl: string | null;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-lg border border-gray-200 px-2.5 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-gray-200" />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-300">
          <Package className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-label font-semibold text-gray-900">{title}</p>
        {subtitle ? <p className="truncate text-micro text-gray-500">{subtitle}</p> : null}
      </div>
      {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-400" /> : <Plus className="h-3.5 w-3.5 shrink-0 text-gray-300" />}
    </button>
  );
}
