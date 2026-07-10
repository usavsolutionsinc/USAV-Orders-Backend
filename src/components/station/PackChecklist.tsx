'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, AlertCircle, Info } from '../Icons';
import { evaluateKitReadiness, type PackingEnforcement } from '@/lib/packing/kit-readiness';
import { usePackingCheckPersist, type PackingTickKind } from '@/hooks/usePackingCheckPersist';

/** A kit/accessory part the box must contain (from sku_kit_parts BOM). */
export interface PackKitPart {
  id: number;
  name: string;
  /** 'PART' | 'ACCESSORY' | 'CABLE' | … (component_type). */
  type: string;
  qty: number;
  critical: boolean;
}

/** A per-SKU verify step (from published qc_check_templates). */
export interface PackCheck {
  id: number;
  label: string;
  category: string | null;
}

interface PackChecklistProps {
  /** "What's in the box" — kit parts + accessories for this SKU. */
  kitParts: PackKitPart[];
  /** Advisory verify-before-sealing steps for this SKU. */
  checks: PackCheck[];
  /**
   * Changing this (the active SKU) clears every tick. The checklist is a
   * per-product surface, so a new scan starts fresh.
   */
  resetKey?: string | null;
  /**
   * Org enforcement mode (from usePackingPolicy). 'block_until_matched' shows a
   * hard blocker until every critical kit part is confirmed; 'advisory'
   * (default) only warns. Graceful degradation: a SKU with no critical parts is
   * never blocked, whatever the mode.
   */
  enforcement?: PackingEnforcement;
  /** Notified when the blocked state flips, so a host can gate its complete CTA. */
  onBlockedChange?: (blocked: boolean) => void;
  /**
   * When set (> 0), each tick is persisted to
   * POST /api/orders/[orderRowId]/packing-checks (tech_verifications,
   * step_type PACKING/PACKING_PART). Optimistic: the tick applies locally
   * first and quietly reverts on failure — persistence never blocks packing.
   */
  orderRowId?: number | null;
  className?: string;
}

const PART_TYPE_TAG: Record<string, string> = {
  ACCESSORY: 'Accessory',
  CABLE: 'Cable',
  MANUAL: 'Manual',
  ADAPTER: 'Adapter',
};

/**
 * Interactive pack-verification checklist shown on the active-order card. It
 * merges the SKU's kit-parts BOM ("items needed in the box") with its advisory
 * QC verify steps, and lets the packer tick each as they confirm it. Critical
 * kit parts (`is_critical`) drive the "all required items in" signal.
 *
 * Ticks apply locally first (the visual aid is instant) and, when an
 * `orderRowId` is supplied, persist to /api/orders/[id]/packing-checks
 * (tech_verifications, Phase 2) with a quiet revert on failure — persistence
 * never gates the pack flow. Renders nothing when the SKU has no BOM and no
 * checks, which is the graceful-degradation path for tenants who haven't
 * populated their catalog (see docs/todo/packing-checklist-plan.md).
 */
export function PackChecklist({
  kitParts,
  checks,
  resetKey,
  enforcement = 'advisory',
  onBlockedChange,
  orderRowId,
  className,
}: PackChecklistProps) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const { persistTick } = usePackingCheckPersist();

  // Fresh product → fresh checklist.
  useEffect(() => {
    setTicked(new Set());
  }, [resetKey]);

  const setKey = (key: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const toggle = (key: string, kind: PackingTickKind, stepId: number) => {
    const nowChecked = !ticked.has(key);
    // Optimistic apply → quiet revert on failure (Phase 2 persistence).
    setKey(key, nowChecked);
    void persistTick(orderRowId, kind, stepId, nowChecked).then((ok) => {
      if (!ok) setKey(key, !nowChecked);
    });
  };

  const totalItems = kitParts.length + checks.length;
  const doneCount = ticked.size;

  // Matched/blocked verdict comes from the shared SoT (kit-readiness) so the
  // packer banner and the kit_verify engine node can never disagree.
  const confirmedPartIds = useMemo(
    () => kitParts.filter((p) => ticked.has(`part-${p.id}`)).map((p) => p.id),
    [kitParts, ticked],
  );
  const readiness = useMemo(
    () =>
      evaluateKitReadiness(
        kitParts.map((p) => ({ id: p.id, critical: p.critical })),
        confirmedPartIds,
        enforcement,
      ),
    [kitParts, confirmedPartIds, enforcement],
  );

  // Let a host (StationPacking) gate its complete CTA on the blocked state.
  useEffect(() => {
    onBlockedChange?.(readiness.blocked);
  }, [readiness.blocked, onBlockedChange]);

  if (totalItems === 0) return null;

  return (
    <div
      className={`mt-3 rounded-2xl border border-border-soft bg-surface-card overflow-hidden ${className ?? ''}`}
    >
      {/* Header — title + live progress */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border-hairline bg-surface-canvas">
        <p className="text-micro font-black text-text-soft uppercase tracking-widest">Pack checklist</p>
        <span
          className={`text-eyebrow font-black tabular-nums ${
            doneCount === totalItems ? 'text-emerald-600' : 'text-text-soft'
          }`}
        >
          {doneCount}/{totalItems} verified
        </span>
      </div>

      {kitParts.length > 0 && (
        <ChecklistGroup label="In the box">
          {kitParts.map((part) => {
            const key = `part-${part.id}`;
            return (
              <ChecklistRow
                key={key}
                checked={ticked.has(key)}
                onToggle={() => toggle(key, 'KIT_PART', part.id)}
                label={part.name}
                qty={part.qty > 1 ? part.qty : undefined}
                tag={PART_TYPE_TAG[part.type] ?? undefined}
                critical={part.critical}
              />
            );
          })}
        </ChecklistGroup>
      )}

      {checks.length > 0 && (
        <ChecklistGroup label="Verify before sealing">
          {checks.map((check) => {
            const key = `check-${check.id}`;
            return (
              <ChecklistRow
                key={key}
                checked={ticked.has(key)}
                onToggle={() => toggle(key, 'PACKING_CHECK', check.id)}
                label={check.label}
              />
            );
          })}
        </ChecklistGroup>
      )}

      {/* Footer signal — informative, never restrictive. block_until_matched
          raises the emphasis (indigo + info) on what still needs including;
          advisory keeps it a quiet amber note. Graceful degradation: no critical
          parts ⇒ requiredTotal 0 ⇒ no footer. */}
      {readiness.requiredTotal > 0 && (
        <div
          className={`flex items-center gap-1.5 px-3 py-2 text-eyebrow font-bold border-t ${
            readiness.allRequiredIn
              ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
              : readiness.blocked
                ? 'text-indigo-700 bg-indigo-50 border-indigo-200'
                : 'text-amber-700 bg-amber-50 border-amber-100'
          }`}
        >
          {readiness.allRequiredIn ? (
            <>
              <Check className="w-3.5 h-3.5 shrink-0" />
              All required items in the box
            </>
          ) : readiness.blocked ? (
            <>
              <Info className="w-3.5 h-3.5 shrink-0" />
              {readiness.missingRequiredIds.length} required{' '}
              {readiness.missingRequiredIds.length === 1 ? 'item' : 'items'} to include in this box
            </>
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {readiness.missingRequiredIds.length} required{' '}
              {readiness.missingRequiredIds.length === 1 ? 'item' : 'items'} not yet confirmed
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ChecklistGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2">
      <p className="text-eyebrow font-black text-text-faint uppercase tracking-wider mb-1.5">{label}</p>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function ChecklistRow({
  checked,
  onToggle,
  label,
  qty,
  tag,
  critical,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  qty?: number;
  tag?: string;
  critical?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={checked}
        className={`ds-raw-button group flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
          checked
            ? 'border-emerald-200 bg-emerald-50'
            : critical
              ? 'border-amber-200 bg-surface-card hover:bg-amber-50'
              : 'border-border-soft bg-surface-card hover:bg-surface-hover'
        }`}
      >
        <span
          aria-hidden
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border ${
            checked
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : critical
                ? 'border-amber-400 bg-surface-card'
                : 'border-border-default bg-surface-card'
          }`}
        >
          {checked && <Check className="h-3 w-3" />}
        </span>
        <span
          className={`flex-1 text-xs font-bold ${
            checked ? 'text-emerald-700 line-through' : 'text-text-default'
          }`}
        >
          {label}
        </span>
        {qty ? (
          <span className="text-eyebrow font-black tabular-nums text-text-soft">×{qty}</span>
        ) : null}
        {tag ? (
          <span className="rounded-md bg-surface-sunken px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wide text-text-soft">
            {tag}
          </span>
        ) : null}
        {critical && !checked ? (
          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wide text-amber-700">
            Required
          </span>
        ) : null}
      </button>
    </li>
  );
}
