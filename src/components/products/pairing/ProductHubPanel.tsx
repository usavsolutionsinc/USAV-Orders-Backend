'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  X,
  Loader2,
  Link2,
  Unlink,
  ExternalLink,
  AlertCircle,
  ChevronDown,
} from '@/components/Icons';
import { PRODUCT_HUB_PLATFORMS, platformStyle } from './platform-style';
import { useProductHub } from './useProductHub';
import type { HubCandidate, HubConfirmed } from './types';

interface ProductHubPanelProps {
  skuCatalogId: number;
}

/**
 * The Product Hub right pane: one row per platform showing confirmed pairings
 * and ranked suggestions, with batch accept/reject + atomic save.
 *
 * Pre-selection: candidates scoring ≥80 are seeded as "accept" by useProductHub
 * so the operator's default action is one Save click. Nothing commits without
 * explicit Save — this is human-in-the-loop by design.
 */
export function ProductHubPanel({ skuCatalogId }: ProductHubPanelProps) {
  const hub = useProductHub(skuCatalogId);
  const snapshot = hub.snapshot;

  // All hooks must run on every render — compute totals up-front and let the
  // JSX branches consume them. Returning early before useMemo trips React's
  // "different hooks rendered" guard.
  const hasAnyContent = useMemo(() => {
    if (!snapshot) return false;
    const c = Object.values(snapshot.confirmed).flat().length;
    const s = Object.values(snapshot.suggestions).flat().length;
    return c + s > 0;
  }, [snapshot]);

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
      <HubHeader
        sku={snapshot.canonicalSku}
        title={snapshot.canonicalTitle}
        confirmedTotal={Object.values(snapshot.confirmed).flat().length}
        suggestionTotal={Object.values(snapshot.suggestions).flat().length}
      />

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!hasAnyContent ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
              <Check className="h-6 w-6 text-emerald-600" />
            </div>
            <p className="mt-3 text-sm font-bold text-gray-700">All channels paired</p>
            <p className="mt-1 text-xs text-gray-500">
              No outstanding suggestions for this product.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {PRODUCT_HUB_PLATFORMS.map((platform) => (
              <ChannelSection
                key={platform}
                platform={platform}
                confirmed={snapshot.confirmed[platform] || []}
                suggestions={snapshot.suggestions[platform] || []}
                pendingByRowId={hub.pendingByRowId}
                onAccept={hub.toggleAccept}
                onReject={hub.toggleReject}
                onUnpair={hub.toggleUnpair}
              />
            ))}
          </div>
        )}
      </div>

      <PendingFooter
        acceptCount={hub.acceptCount}
        rejectCount={hub.rejectCount}
        unpairCount={hub.unpairCount}
        saving={hub.saving}
        saveError={hub.saveError}
        onSave={hub.commit}
        onDiscard={hub.clearPending}
      />
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function HubHeader({
  sku,
  title,
  confirmedTotal,
  suggestionTotal,
}: {
  sku: string;
  title: string | null;
  confirmedTotal: number;
  suggestionTotal: number;
}) {
  return (
    <header className="shrink-0 border-b border-gray-200 bg-white px-4 py-3">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-lg font-black tracking-tight text-gray-900">{sku}</span>
        <span className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-700">
          Zoho
        </span>
      </div>
      <p className="mt-1 text-sm font-bold leading-snug text-gray-900">{title || '—'}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        <span>
          <span className="text-emerald-600">✓ {confirmedTotal}</span> confirmed
        </span>
        <span>
          <span className="text-amber-600">⌛ {suggestionTotal}</span> suggested
        </span>
      </div>
    </header>
  );
}

// ─── Per-platform section ───────────────────────────────────────────────────

function ChannelSection({
  platform,
  confirmed,
  suggestions,
  pendingByRowId,
  onAccept,
  onReject,
  onUnpair,
}: {
  platform: string;
  confirmed: HubConfirmed[];
  suggestions: HubCandidate[];
  pendingByRowId: Map<number, { kind: 'accept' | 'reject' | 'unpair' }>;
  onAccept: (c: HubCandidate) => void;
  onReject: (c: HubCandidate) => void;
  onUnpair: (c: HubConfirmed) => void;
}) {
  const style = platformStyle(platform);
  const [showAll, setShowAll] = useState(false);

  if (confirmed.length === 0 && suggestions.length === 0) {
    return (
      <section className={`border-l-2 py-2 pl-3 ${style.ring}`}>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${style.chip}`}
          >
            {style.label}
          </span>
          <span className="text-[10px] text-gray-400">empty</span>
        </div>
      </section>
    );
  }

  const visibleSuggestions = showAll ? suggestions : suggestions.slice(0, 1);
  const moreCount = suggestions.length - visibleSuggestions.length;

  return (
    <section className={`border-l-2 py-2 pl-3 ${style.ring}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${style.chip}`}
        >
          {style.label}
        </span>
      </div>

      <div className="space-y-1">
        {confirmed.map((c) => (
          <ConfirmedRow
            key={`c-${c.platformIdRowId}`}
            confirmed={c}
            pending={pendingByRowId.get(c.platformIdRowId)?.kind}
            onUnpair={onUnpair}
          />
        ))}
        {visibleSuggestions.map((c) => (
          <SuggestionRow
            key={`s-${c.platformIdRowId}`}
            candidate={c}
            pending={pendingByRowId.get(c.platformIdRowId)?.kind}
            onAccept={onAccept}
            onReject={onReject}
          />
        ))}
      </div>

      {!showAll && moreCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-blue-600 hover:text-blue-800"
        >
          See {moreCount} more <ChevronDown className="h-3 w-3" />
        </button>
      )}
    </section>
  );
}

// ─── Rows ───────────────────────────────────────────────────────────────────

function ConfirmedRow({
  confirmed,
  pending,
  onUnpair,
}: {
  confirmed: HubConfirmed;
  pending: 'accept' | 'reject' | 'unpair' | undefined;
  onUnpair: (c: HubConfirmed) => void;
}) {
  const willUnpair = pending === 'unpair';
  const value =
    confirmed.platformSku?.trim() || confirmed.platformItemId?.trim() || '—';
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
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-xs font-bold text-gray-900">{value}</span>
          {confirmed.accountName && (
            <span className="truncate text-[10px] font-medium uppercase tracking-wider text-gray-500">
              {confirmed.accountName}
            </span>
          )}
        </div>
        {confirmed.listingTitle && (
          <p className="truncate text-[10px] text-gray-500">{confirmed.listingTitle}</p>
        )}
      </div>
      {confirmed.listingUrl && (
        <a
          href={confirmed.listingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded p-1 text-gray-400 hover:bg-white hover:text-blue-600"
          title="Open listing"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
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
  pending,
  onAccept,
  onReject,
}: {
  candidate: HubCandidate;
  pending: 'accept' | 'reject' | 'unpair' | undefined;
  onAccept: (c: HubCandidate) => void;
  onReject: (c: HubCandidate) => void;
}) {
  const value =
    candidate.platformSku?.trim() || candidate.platformItemId?.trim() || '—';
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
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-xs font-bold text-gray-900">{value}</span>
            {candidate.accountName && (
              <span className="truncate text-[10px] font-medium uppercase tracking-wider text-gray-500">
                {candidate.accountName}
              </span>
            )}
            <span className="ml-auto shrink-0 text-[10px] font-bold text-gray-600">
              {candidate.confidence}
            </span>
          </div>
          {candidate.listingTitle && (
            <p className="truncate text-[10px] text-gray-600">{candidate.listingTitle}</p>
          )}
          <p className="truncate text-[9px] font-medium uppercase tracking-wider text-gray-400">
            {candidate.reason}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
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

// ─── Pending action bar ─────────────────────────────────────────────────────

function PendingFooter({
  acceptCount,
  rejectCount,
  unpairCount,
  saving,
  saveError,
  onSave,
  onDiscard,
}: {
  acceptCount: number;
  rejectCount: number;
  unpairCount: number;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const total = acceptCount + rejectCount + unpairCount;
  if (total === 0 && !saveError) return null;

  return (
    <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3">
      {saveError && (
        <div className="mb-2 flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-700">
          <AlertCircle className="h-3.5 w-3.5" />
          {saveError}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 flex-wrap gap-3 text-[11px] font-bold uppercase tracking-wider text-gray-600">
          {acceptCount > 0 && <span className="text-blue-700">{acceptCount} accept</span>}
          {rejectCount > 0 && <span className="text-gray-700">{rejectCount} reject</span>}
          {unpairCount > 0 && <span className="text-orange-700">{unpairCount} unpair</span>}
        </div>
        <button
          type="button"
          onClick={onDiscard}
          disabled={saving || total === 0}
          className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-bold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || total === 0}
          className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          Save {total}
        </button>
      </div>
    </div>
  );
}
