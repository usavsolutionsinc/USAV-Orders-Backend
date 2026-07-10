'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, AlertCircle, Info, Loader2 } from '@/components/Icons';
import { evaluateKitReadiness, type PackingEnforcement } from '@/lib/packing/kit-readiness';
import type { PackChecklistLineDto } from '@/lib/packing/order-pack-checklist';
import { usePackingCheckPersist } from '@/hooks/usePackingCheckPersist';
import { PackChecklistLineRow } from './PackChecklistLineRow';

interface OrderPackChecklistProps {
  lines: PackChecklistLineDto[];
  enforcement?: PackingEnforcement;
  resetKey?: string | null;
  onBlockedChange?: (blocked: boolean) => void;
  variant?: 'station' | 'mobile' | 'panel';
  isLoading?: boolean;
  className?: string;
  /** Highlight + expand this line (e.g. after SKU scan on mobile). */
  highlightOrderRowId?: number | null;
}

function lineKey(line: PackChecklistLineDto): string {
  return line.orderRowId > 0 ? `line-${line.orderRowId}` : `sku-${line.sku || line.productTitle}`;
}

/**
 * Order-scoped pack checklist — one accordion row per order line (SKU).
 * Collapsed: checkmark + title; expanded: catalog photo + kit parts + QC steps.
 */
export function OrderPackChecklist({
  lines,
  enforcement = 'advisory',
  resetKey,
  onBlockedChange,
  variant = 'station',
  isLoading = false,
  className,
  highlightOrderRowId,
}: OrderPackChecklistProps) {
  const [tickedLines, setTickedLines] = useState<Set<string>>(new Set());
  const [tickedKitParts, setTickedKitParts] = useState<Set<number>>(new Set());
  const [tickedChecks, setTickedChecks] = useState<Set<number>>(new Set());
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const { persistTick } = usePackingCheckPersist();

  const setInSet = (
    setter: React.Dispatch<React.SetStateAction<Set<number>>>,
    id: number,
    on: boolean,
  ) =>
    setter((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  useEffect(() => {
    setTickedLines(new Set());
    setTickedKitParts(new Set());
    setTickedChecks(new Set());
    setExpandedKey(null);
  }, [resetKey]);

  useEffect(() => {
    if (highlightOrderRowId == null || highlightOrderRowId <= 0) return;
    const match = lines.find((l) => l.orderRowId === highlightOrderRowId);
    if (match) setExpandedKey(lineKey(match));
  }, [highlightOrderRowId, lines]);

  const toggleLine = (key: string) =>
    setTickedLines((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const confirmedPartIds = useMemo(
    () => lines.flatMap((l) => l.kitParts.filter((p) => tickedKitParts.has(p.id)).map((p) => p.id)),
    [lines, tickedKitParts],
  );

  const readiness = useMemo(
    () =>
      evaluateKitReadiness(
        lines.flatMap((l) => l.kitParts.map((p) => ({ id: p.id, critical: p.critical }))),
        confirmedPartIds,
        enforcement,
      ),
    [lines, confirmedPartIds, enforcement],
  );

  useEffect(() => {
    onBlockedChange?.(readiness.blocked);
  }, [readiness.blocked, onBlockedChange]);

  const doneCount = tickedLines.size;
  const totalCount = lines.length;

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center gap-2 rounded-2xl border border-border-soft bg-surface-card py-8 ${className ?? ''}`}>
        <Loader2 className="h-4 w-4 animate-spin text-text-faint" />
        <span className="text-caption font-semibold text-text-faint">Loading checklist…</span>
      </div>
    );
  }

  if (lines.length === 0) return null;

  return (
    <div
      className={`rounded-2xl border border-border-soft bg-surface-card overflow-hidden ${className ?? ''}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border-hairline bg-surface-canvas px-3 py-2">
        <p className="text-micro font-black uppercase tracking-widest text-text-soft">Pack checklist</p>
        <span
          className={`text-eyebrow font-black tabular-nums ${
            doneCount === totalCount ? 'text-emerald-600' : 'text-text-soft'
          }`}
        >
          {doneCount}/{totalCount} lines verified
        </span>
      </div>

      <ul>
        {lines.map((line) => {
          const key = lineKey(line);
          return (
            <PackChecklistLineRow
              key={key}
              line={line}
              checked={tickedLines.has(key)}
              expanded={expandedKey === key}
              onToggleCheck={() => toggleLine(key)}
              onToggleExpand={() => setExpandedKey((prev) => (prev === key ? null : key))}
              tickedKitParts={tickedKitParts}
              onToggleKitPart={(partId) => {
                // Optimistic apply → quiet revert on persist failure (Phase 2).
                const nowChecked = !tickedKitParts.has(partId);
                setInSet(setTickedKitParts, partId, nowChecked);
                void persistTick(line.orderRowId, 'KIT_PART', partId, nowChecked).then((ok) => {
                  if (!ok) setInSet(setTickedKitParts, partId, !nowChecked);
                });
              }}
              tickedChecks={tickedChecks}
              onToggleCheckItem={(checkId) => {
                const nowChecked = !tickedChecks.has(checkId);
                setInSet(setTickedChecks, checkId, nowChecked);
                void persistTick(line.orderRowId, 'PACKING_CHECK', checkId, nowChecked).then((ok) => {
                  if (!ok) setInSet(setTickedChecks, checkId, !nowChecked);
                });
              }}
              variant={variant}
            />
          );
        })}
      </ul>

      {readiness.requiredTotal > 0 ? (
        <div
          className={`flex items-center gap-1.5 border-t px-3 py-2 text-eyebrow font-bold ${
            readiness.allRequiredIn
              ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
              : readiness.blocked
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                : 'border-amber-100 bg-amber-50 text-amber-700'
          }`}
        >
          {readiness.allRequiredIn ? (
            <>
              <Check className="h-3.5 w-3.5 shrink-0" />
              All required items in the box
            </>
          ) : readiness.blocked ? (
            <>
              <Info className="h-3.5 w-3.5 shrink-0" />
              {readiness.missingRequiredIds.length} required{' '}
              {readiness.missingRequiredIds.length === 1 ? 'item' : 'items'} to include
            </>
          ) : (
            <>
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {readiness.missingRequiredIds.length} required{' '}
              {readiness.missingRequiredIds.length === 1 ? 'item' : 'items'} not yet confirmed
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
