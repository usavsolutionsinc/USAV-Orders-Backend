'use client';

import { useCallback, useId, useRef, useState, type MouseEvent } from 'react';
import {
  Check,
  X,
  Loader2,
  Link2,
  Unlink,
  ExternalLink,
  AlertCircle,
  ChevronDown,
  Plus,
  Clipboard,
} from '@/components/Icons';
import { TextField } from '@/design-system/primitives/TextField';
import { PRODUCT_HUB_PLATFORMS, platformStyle } from './platform-style';
import { useProductHub } from './useProductHub';
import type { HubCandidate, HubConfirmed } from './types';
import { ListingResizePanel } from '@/components/listing/ListingResizePanel';
import { isElectron } from '@/utils/isElectron';
import { useSiteTooltipOptional } from '@/components/providers/SiteTooltipProvider';

interface ProductHubPanelProps {
  skuCatalogId: number;
  /**
   * When true, render an inline "add a pairing manually" form above the channel
   * list — pick a platform and type a SKU/identifier to link it directly. Off by
   * default so the products pairing page stays suggestion-only; enabled in the
   * testing-workspace pairing modal.
   */
  allowManualPair?: boolean;
}

/**
 * The Product Hub right pane: one row per platform showing confirmed pairings
 * and ranked suggestions, with batch accept/reject + atomic save.
 *
 * Pre-selection: candidates scoring ≥80 are seeded as "accept" by useProductHub
 * so the operator's default action is one Save click. Nothing commits without
 * explicit Save — this is human-in-the-loop by design.
 */
export function ProductHubPanel({ skuCatalogId, allowManualPair = false }: ProductHubPanelProps) {
  const hub = useProductHub(skuCatalogId);
  const snapshot = hub.snapshot;

  // Preview pane state: a row's external-link button selects its URL; the
  // ListingResizePanel mounts the URL inside an embedded Electron webview.
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const canEmbedListing = isElectron();
  const openPreview = useCallback((url: string, label: string) => {
    setPreview({ url, label });
  }, []);

  if (hub.loading && !snapshot) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="ml-2 text-xs font-semibold">Loading suggestions…</span>
      </div>
    );
  }

  if (hub.error || !snapshot) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mr-1 inline h-4 w-4" />
          {hub.error || 'Could not load suggestions'}
        </div>
        <button
          type="button"
          onClick={hub.refresh}
          className="mt-3 rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HubHeader sku={snapshot.canonicalSku} title={snapshot.canonicalTitle} />

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {allowManualPair ? (
          <ManualPairForm skuCatalogId={skuCatalogId} onAdded={hub.refresh} />
        ) : null}
        <div className="divide-y divide-gray-100">
          {PRODUCT_HUB_PLATFORMS.map((platform) => (
            <ChannelSection
              key={platform}
              platform={platform}
              confirmed={snapshot.confirmed[platform] || []}
              suggestions={snapshot.suggestions[platform] || []}
              canonicalTitle={snapshot.canonicalTitle}
              skuCatalogId={skuCatalogId}
              onAdded={hub.refresh}
              pendingByRowId={hub.pendingByRowId}
              onAccept={hub.toggleAccept}
              onReject={hub.toggleReject}
              onUnpair={hub.toggleUnpair}
              onPreview={openPreview}
              activePreviewUrl={preview?.url ?? null}
            />
          ))}
        </div>
      </div>

      <PendingFooter
        selectedCount={hub.acceptCount}
        unselectedCount={Math.max(0, hub.suggestionTotal - hub.acceptCount)}
        unpairCount={hub.unpairCount}
        saving={hub.saving}
        saveError={hub.saveError}
        onCommit={hub.commitDecisive}
        onDiscard={hub.clearPending}
      />

      {preview ? (
        <ListingResizePanel
          key={preview.url}
          url={preview.url}
          canEmbed={canEmbedListing}
          title={preview.label}
          storageNamespace="productsPairing"
        />
      ) : null}
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function HubHeader({ sku, title }: { sku: string; title: string | null }) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-4">
      <h1 className="min-w-0 flex-1 truncate text-sm font-black tracking-tight text-gray-900">
        {title || '—'}
      </h1>
      <span className="inline-flex shrink-0 items-center rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-eyebrow font-semibold uppercase tracking-wider text-red-700">
        Zoho
      </span>
      <CopyableId
        value={sku}
        className="shrink-0 font-mono text-caption font-bold tracking-tight text-gray-500"
      />
    </header>
  );
}

// ─── Per-platform section ───────────────────────────────────────────────────

function ChannelSection({
  platform,
  confirmed,
  suggestions,
  canonicalTitle,
  skuCatalogId,
  onAdded,
  pendingByRowId,
  onAccept,
  onReject,
  onUnpair,
  onPreview,
  activePreviewUrl,
}: {
  platform: string;
  confirmed: HubConfirmed[];
  suggestions: HubCandidate[];
  canonicalTitle: string | null;
  skuCatalogId: number;
  onAdded: () => void;
  pendingByRowId: Map<number, { kind: 'accept' | 'reject' | 'unpair' }>;
  onAccept: (c: HubCandidate) => void;
  onReject: (c: HubCandidate) => void;
  onUnpair: (c: HubConfirmed) => void;
  onPreview: (url: string, label: string) => void;
  activePreviewUrl: string | null;
}) {
  const style = platformStyle(platform);
  const [showAll, setShowAll] = useState(false);

  if (confirmed.length === 0 && suggestions.length === 0) {
    return (
      <section className={`border-l-2 py-2 pl-3 ${style.ring}`}>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wider ${style.chip}`}
          >
            {style.label}
          </span>
          <span className="text-micro text-gray-400">empty</span>
        </div>
        <ChannelManualAdd platform={platform} skuCatalogId={skuCatalogId} onAdded={onAdded} />
      </section>
    );
  }

  const visibleSuggestions = showAll ? suggestions : suggestions.slice(0, 1);
  const moreCount = suggestions.length - visibleSuggestions.length;

  return (
    <section className={`border-l-2 py-2 pl-3 ${style.ring}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wider ${style.chip}`}
        >
          {style.label}
        </span>
      </div>

      <div className="space-y-1">
        {confirmed.map((c) => (
          <ConfirmedRow
            key={`c-${c.platformIdRowId}`}
            confirmed={c}
            canonicalTitle={canonicalTitle}
            pending={pendingByRowId.get(c.platformIdRowId)?.kind}
            onUnpair={onUnpair}
            onPreview={onPreview}
            isPreviewing={!!c.listingUrl && c.listingUrl === activePreviewUrl}
          />
        ))}
        {visibleSuggestions.map((c) => (
          <SuggestionRow
            key={`s-${c.platformIdRowId}`}
            candidate={c}
            canonicalTitle={canonicalTitle}
            pending={pendingByRowId.get(c.platformIdRowId)?.kind}
            onAccept={onAccept}
            onReject={onReject}
            onPreview={onPreview}
            isPreviewing={!!c.listingUrl && c.listingUrl === activePreviewUrl}
          />
        ))}
      </div>

      {!showAll && moreCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-1.5 inline-flex items-center gap-1 text-micro font-semibold uppercase tracking-wider text-blue-600 hover:text-blue-800"
        >
          See {moreCount} more <ChevronDown className="h-3 w-3" />
        </button>
      )}

      <ChannelManualAdd platform={platform} skuCatalogId={skuCatalogId} onAdded={onAdded} />
    </section>
  );
}

// ─── Rows ───────────────────────────────────────────────────────────────────

/**
 * A hover-to-copy identifier. Shows the full SKU/item value (no last-4 trim) in
 * the row's mono style, surfaces the site copy tooltip on hover/focus, and writes
 * the raw value to the clipboard on click. Reuses the shared SiteTooltipProvider
 * so the "click to copy → Copied" bubble matches the rest of the app.
 */
function CopyableId({ value, className = '' }: { value: string; className?: string }) {
  const anchorId = useId();
  const ref = useRef<HTMLButtonElement | null>(null);
  const tooltip = useSiteTooltipOptional();
  const getRect = useCallback(() => ref.current?.getBoundingClientRect() ?? null, []);
  const trimmed = value.trim();

  const open = useCallback(() => {
    if (tooltip && trimmed) tooltip.activate({ anchorId, value: trimmed, getRect });
  }, [tooltip, trimmed, anchorId, getRect]);
  const close = useCallback(() => tooltip?.scheduleClose(anchorId), [tooltip, anchorId]);

  const copy = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (!trimmed) return;
      void navigator.clipboard?.writeText(trimmed);
      if (tooltip?.isActiveAnchor(anchorId)) tooltip.notifyCopied(anchorId);
    },
    [trimmed, tooltip, anchorId],
  );

  return (
    <button
      ref={ref}
      type="button"
      onClick={copy}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      disabled={!trimmed}
      title={!tooltip && trimmed ? trimmed : undefined}
      className={`min-w-0 truncate text-left transition-colors hover:text-blue-600 hover:underline disabled:no-underline disabled:hover:text-current ${className}`}
    >
      {value}
    </button>
  );
}

/**
 * A platform mapping can carry two identifiers — a merchant SKU (platform_sku)
 * and a marketplace item id (platform_item_id, e.g. an Amazon ASIN). Show BOTH
 * when present, joined by a dot: the SKU as the primary token, the raw item id
 * second. `primary` doubles as the preview-pane label.
 *
 * Ecwid is the exception: its platform_item_id is an internal numeric product id
 * (e.g. 739085920) that's noise to the operator — show the SKU only.
 */
function identifierParts(
  platform: string,
  platformSku: string | null,
  platformItemId: string | null,
): { primary: string; secondary: string | null } {
  const sku = platformSku?.trim() || '';
  const item = platformItemId?.trim() || '';
  if (platform === 'ecwid') {
    return { primary: sku || item || '—', secondary: null };
  }
  const primary = sku || item || '—';
  const hasBoth = !!sku && !!item && sku.toUpperCase() !== item.toUpperCase();
  return { primary, secondary: hasBoth ? item : null };
}


function ConfirmedRow({
  confirmed,
  canonicalTitle,
  pending,
  onUnpair,
  onPreview,
  isPreviewing,
}: {
  confirmed: HubConfirmed;
  canonicalTitle: string | null;
  pending: 'accept' | 'reject' | 'unpair' | undefined;
  onUnpair: (c: HubConfirmed) => void;
  onPreview: (url: string, label: string) => void;
  isPreviewing: boolean;
}) {
  const willUnpair = pending === 'unpair';
  const { primary: value, secondary } = identifierParts(
    confirmed.platform,
    confirmed.platformSku,
    confirmed.platformItemId,
  );
  // Always show a product title. Marketplace rows (notably Ecwid) often have no
  // listing_title/display_name of their own — fall back to the canonical title.
  const rowTitle = confirmed.listingTitle?.trim() || canonicalTitle?.trim() || '';
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
        willUnpair
          ? 'border-orange-200 bg-orange-50/60'
          : 'border-emerald-200 bg-emerald-50/40'
      }`}
    >
      <Check className={`h-3.5 w-3.5 shrink-0 ${willUnpair ? 'text-orange-500' : 'text-emerald-600'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 font-mono text-xs font-bold text-gray-900">
          <CopyableId value={value} />
          {secondary ? (
            <>
              <span className="shrink-0 text-gray-400">·</span>
              <CopyableId value={secondary} />
            </>
          ) : null}
          {confirmed.accountName && (
            <span className="shrink-0 truncate text-micro font-medium uppercase tracking-wider text-gray-500">
              {confirmed.accountName}
            </span>
          )}
        </div>
        {rowTitle && (
          <p className="truncate text-micro text-gray-500">{rowTitle}</p>
        )}
      </div>
      {confirmed.listingUrl && (
        <button
          type="button"
          onClick={() => onPreview(confirmed.listingUrl!, confirmed.listingTitle || value)}
          className={`shrink-0 rounded p-1 transition-colors ${
            isPreviewing
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'text-gray-400 hover:bg-white hover:text-blue-600'
          }`}
          title={isPreviewing ? 'Showing in preview pane' : 'Preview listing below'}
          aria-label="Preview listing"
          aria-pressed={isPreviewing}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onUnpair(confirmed)}
        className={`shrink-0 rounded p-1 transition-colors ${
          willUnpair
            ? 'bg-orange-500 text-white hover:bg-orange-600'
            : 'text-gray-400 hover:bg-white hover:text-orange-600'
        }`}
        title={willUnpair ? 'Cancel unpair' : 'Unpair this mapping'}
        aria-label={willUnpair ? 'Cancel unpair' : 'Unpair'}
      >
        <Unlink className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function SuggestionRow({
  candidate,
  canonicalTitle,
  pending,
  onAccept,
  onReject,
  onPreview,
  isPreviewing,
}: {
  candidate: HubCandidate;
  canonicalTitle: string | null;
  pending: 'accept' | 'reject' | 'unpair' | undefined;
  onAccept: (c: HubCandidate) => void;
  onReject: (c: HubCandidate) => void;
  onPreview: (url: string, label: string) => void;
  isPreviewing: boolean;
}) {
  const { primary: value, secondary } = identifierParts(
    candidate.platform,
    candidate.platformSku,
    candidate.platformItemId,
  );
  const rowTitle = candidate.listingTitle?.trim() || canonicalTitle?.trim() || '';
  const tone =
    pending === 'accept'
      ? 'border-blue-300 bg-blue-50'
      : pending === 'reject'
        ? 'border-gray-200 bg-gray-50 opacity-60'
        : candidate.confidence >= 80
          ? 'border-amber-200 bg-amber-50/40'
          : 'border-gray-200 bg-white';

  const dotColor =
    candidate.confidence >= 80 ? 'bg-emerald-500'
    : candidate.confidence >= 60 ? 'bg-amber-500'
    : 'bg-slate-400';

  return (
    <div className={`rounded-md border px-2 py-1.5 ${tone}`}>
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-2 w-2 shrink-0 rounded-full ${dotColor}`}
          title={candidate.reason}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 font-mono text-xs font-bold text-gray-900">
            <CopyableId value={value} />
            {secondary ? (
              <>
                <span className="shrink-0 text-gray-400">·</span>
                <CopyableId value={secondary} />
              </>
            ) : null}
            {candidate.accountName && (
              <span className="shrink-0 truncate text-micro font-medium uppercase tracking-wider text-gray-500">
                {candidate.accountName}
              </span>
            )}
            <span className="ml-auto shrink-0 text-micro font-bold text-gray-600">
              {candidate.confidence}
            </span>
          </div>
          {rowTitle && (
            <p className="truncate text-micro text-gray-600">{rowTitle}</p>
          )}
          <p className="truncate text-eyebrow font-medium uppercase tracking-wider text-gray-400">
            {candidate.reason}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {candidate.listingUrl && (
            <button
              type="button"
              onClick={() => onPreview(candidate.listingUrl!, candidate.listingTitle || value)}
              className={`rounded p-1 transition-colors ${
                isPreviewing
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'text-gray-400 hover:bg-white hover:text-blue-600'
              }`}
              title={isPreviewing ? 'Showing in preview pane' : 'Preview listing below'}
              aria-label="Preview listing"
              aria-pressed={isPreviewing}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onAccept(candidate)}
            className={`rounded p-1 transition-colors ${
              pending === 'accept'
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'text-gray-400 hover:bg-white hover:text-blue-600'
            }`}
            title={pending === 'accept' ? 'Will accept on save' : 'Accept this match'}
            aria-label="Accept"
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onReject(candidate)}
            className={`rounded p-1 transition-colors ${
              pending === 'reject'
                ? 'bg-gray-700 text-white hover:bg-gray-800'
                : 'text-gray-400 hover:bg-white hover:text-gray-700'
            }`}
            title={pending === 'reject' ? 'Will hide for 30 days' : 'Reject this match'}
            aria-label="Reject"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Paste button (clipboard → field) ───────────────────────────────────────

function PasteButton({ onPaste }: { onPaste: (value: string) => void }) {
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) onPaste(text.trim());
        } catch {
          /* clipboard blocked — operator can still type */
        }
      }}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-600"
      title="Paste from clipboard"
      aria-label="Paste from clipboard"
    >
      <Clipboard className="h-3.5 w-3.5" />
    </button>
  );
}

// ─── Per-platform manual add ─────────────────────────────────────────────────

/**
 * Inline "add an identifier to THIS platform" control, shown on every channel
 * row (including empty ones). Lets the operator hand-enter an item number and/or
 * a SKU for the platform and link it — uses the TextField primitive with a paste
 * button on each entry. Posts a single manual accept to /api/sku-catalog/pair-batch
 * (the same atomic + audited path Save uses), then refreshes the hub.
 */
function ChannelManualAdd({
  platform,
  skuCatalogId,
  onAdded,
}: {
  platform: string;
  skuCatalogId: number;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [itemNumber, setItemNumber] = useState('');
  const [sku, setSku] = useState('');
  const [account, setAccount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setItemNumber('');
    setSku('');
    setAccount('');
    setError(null);
    setOpen(false);
  }, []);

  const submit = useCallback(async () => {
    const trimmedItem = itemNumber.trim();
    const trimmedSku = sku.trim();
    if (!trimmedItem && !trimmedSku) {
      setError('Enter an item number or SKU');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/sku-catalog/pair-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          skuCatalogId,
          accept: [
            {
              platform,
              platformItemId: trimmedItem || null,
              platformSku: trimmedSku || null,
              accountName: account.trim() || null,
              confidence: 100,
              reason: 'manual_add',
            },
          ],
          reject: [],
          unpair: [],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) throw new Error(body?.error || `HTTP ${res.status}`);
      window.dispatchEvent(new CustomEvent('sku-pairing-updated'));
      close();
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setSaving(false);
    }
  }, [account, close, itemNumber, onAdded, platform, sku, skuCatalogId]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 inline-flex items-center gap-1 text-eyebrow font-bold uppercase tracking-wider text-gray-400 transition-colors hover:text-blue-600"
      >
        <Plus className="h-3 w-3" /> Add {platformStyle(platform).label} identifier
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-2.5">
      <TextField
        label="Item number"
        value={itemNumber}
        onChange={setItemNumber}
        mono
        trailing={<PasteButton onPaste={setItemNumber} />}
      />
      <TextField
        label="SKU"
        value={sku}
        onChange={setSku}
        mono
        trailing={<PasteButton onPaste={setSku} />}
      />
      <TextField label="Account (optional)" value={account} onChange={setAccount} />
      {error ? <p className="text-micro font-semibold text-red-600">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={close}
          className="rounded-lg px-2.5 py-1.5 text-micro font-bold uppercase tracking-wider text-gray-500 transition-colors hover:bg-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || (!itemNumber.trim() && !sku.trim())}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-micro font-bold uppercase tracking-wider text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          Add
        </button>
      </div>
    </div>
  );
}

// ─── Manual add ─────────────────────────────────────────────────────────────

/**
 * Inline "pair a SKU by hand" form. Posts a single inline-create accept entry
 * to /api/sku-catalog/pair-batch (the same atomic + audited path the Save
 * button uses), then refreshes the hub so the new row shows under its channel.
 * Used when a platform listing isn't in the ranked suggestions yet.
 */
function ManualPairForm({
  skuCatalogId,
  onAdded,
}: {
  skuCatalogId: number;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<string>(PRODUCT_HUB_PLATFORMS[0]);
  const [sku, setSku] = useState('');
  const [account, setAccount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSku('');
    setAccount('');
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    const value = sku.trim();
    if (!value) {
      setError('Enter a SKU or identifier');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/sku-catalog/pair-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          skuCatalogId,
          accept: [
            {
              platform,
              platformSku: value,
              accountName: account.trim() || null,
              confidence: 100,
              reason: 'manual_add',
            },
          ],
          reject: [],
          unpair: [],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      window.dispatchEvent(new CustomEvent('sku-pairing-updated'));
      reset();
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add pairing');
    } finally {
      setSaving(false);
    }
  }, [account, onAdded, platform, reset, sku, skuCatalogId]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-2.5 py-1.5 text-micro font-bold uppercase tracking-wider text-gray-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
      >
        <Plus className="h-3.5 w-3.5" />
        Pair a SKU manually
      </button>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-micro font-bold uppercase tracking-wider text-blue-700">
          Manual pairing
        </span>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          aria-label="Cancel manual pairing"
          className="rounded p-0.5 text-gray-400 transition-colors hover:bg-white hover:text-gray-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-eyebrow font-semibold uppercase tracking-wider text-gray-500">
            Platform
          </span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs font-semibold text-gray-900 focus:border-blue-400 focus:outline-none"
          >
            {PRODUCT_HUB_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {platformStyle(p).label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[8rem] flex-1 flex-col gap-0.5">
          <span className="text-eyebrow font-semibold uppercase tracking-wider text-gray-500">
            SKU / identifier
          </span>
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !saving) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="e.g. 01815"
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-xs text-gray-900 focus:border-blue-400 focus:outline-none"
          />
        </label>
        <label className="flex min-w-[7rem] flex-1 flex-col gap-0.5">
          <span className="text-eyebrow font-semibold uppercase tracking-wider text-gray-500">
            Account <span className="font-normal normal-case text-gray-400">(optional)</span>
          </span>
          <input
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="e.g. DRAGONH"
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-blue-400 focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || !sku.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          Pair
        </button>
      </div>
      {error ? (
        <p className="mt-1.5 text-micro font-semibold text-red-600">{error}</p>
      ) : null}
    </div>
  );
}

// ─── Pending action bar ─────────────────────────────────────────────────────

function PendingFooter({
  selectedCount,
  unselectedCount,
  unpairCount,
  saving,
  saveError,
  onCommit,
  onDiscard,
}: {
  /** Suggestions currently selected (will be paired). */
  selectedCount: number;
  /** Suggestions left unselected (will be rejected). */
  unselectedCount: number;
  /** Confirmed rows marked to unpair. */
  unpairCount: number;
  saving: boolean;
  saveError: string | null;
  /** Pair all selected + reject all unselected in one commit. */
  onCommit: () => void;
  onDiscard: () => void;
}) {
  const actionable = selectedCount + unselectedCount + unpairCount;
  if (actionable === 0 && !saveError) return null;

  return (
    <div className="sticky bottom-0 z-10 border-t border-gray-200 bg-white/90 py-3 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 px-4 sm:px-6">
        {saveError ? (
          <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-caption font-semibold text-red-700">
            <AlertCircle className="h-3.5 w-3.5" />
            {saveError}
          </div>
        ) : null}

        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving || actionable === 0}
            className="inline-flex h-9 items-center justify-center rounded-md border border-gray-200 bg-white px-3 text-caption font-bold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onCommit}
            disabled={saving || actionable === 0}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-gray-900 px-4 text-caption font-black uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            <span>
              Pair {selectedCount} · Reject {unselectedCount}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
