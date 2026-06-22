'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, AlertCircle } from '../Icons';

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
 * Phase 1 (P1-PCK-03): ticks are client-only — this is a visual aid, never a
 * gate. Persistence + per-org block-until-matched enforcement land in later
 * phases (see docs/packing-checklist-plan.md). Renders nothing when the SKU has
 * no BOM and no checks, which is the graceful-degradation path for tenants who
 * haven't populated their catalog.
 */
export function PackChecklist({ kitParts, checks, resetKey, className }: PackChecklistProps) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  // Fresh product → fresh checklist.
  useEffect(() => {
    setTicked(new Set());
  }, [resetKey]);

  const toggle = (key: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const criticalKeys = useMemo(
    () => kitParts.filter((p) => p.critical).map((p) => `part-${p.id}`),
    [kitParts],
  );
  const totalItems = kitParts.length + checks.length;
  const doneCount = ticked.size;
  const criticalRemaining = criticalKeys.filter((k) => !ticked.has(k)).length;
  const allCriticalIn = criticalKeys.length > 0 && criticalRemaining === 0;

  if (totalItems === 0) return null;

  return (
    <div
      className={`mt-3 rounded-2xl border border-gray-200 bg-white overflow-hidden ${className ?? ''}`}
    >
      {/* Header — title + live progress */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-100 bg-gray-50">
        <p className="text-micro font-black text-gray-500 uppercase tracking-widest">Pack checklist</p>
        <span
          className={`text-eyebrow font-black tabular-nums ${
            doneCount === totalItems ? 'text-emerald-600' : 'text-gray-500'
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
                onToggle={() => toggle(key)}
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
                onToggle={() => toggle(key)}
                label={check.label}
              />
            );
          })}
        </ChecklistGroup>
      )}

      {/* Footer signal — advisory only (never blocks in Phase 1) */}
      {criticalKeys.length > 0 && (
        <div
          className={`flex items-center gap-1.5 px-3 py-2 text-eyebrow font-bold border-t ${
            allCriticalIn
              ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
              : 'text-amber-700 bg-amber-50 border-amber-100'
          }`}
        >
          {allCriticalIn ? (
            <>
              <Check className="w-3.5 h-3.5 shrink-0" />
              All required items in the box
            </>
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {criticalRemaining} required {criticalRemaining === 1 ? 'item' : 'items'} not yet confirmed
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
      <p className="text-eyebrow font-black text-gray-400 uppercase tracking-wider mb-1.5">{label}</p>
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
        className={`group flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
          checked
            ? 'border-emerald-200 bg-emerald-50'
            : critical
              ? 'border-amber-200 bg-white hover:bg-amber-50'
              : 'border-gray-200 bg-white hover:bg-gray-50'
        }`}
      >
        <span
          aria-hidden
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border ${
            checked
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : critical
                ? 'border-amber-400 bg-white'
                : 'border-gray-300 bg-white'
          }`}
        >
          {checked && <Check className="h-3 w-3" />}
        </span>
        <span
          className={`flex-1 text-xs font-bold ${
            checked ? 'text-emerald-700 line-through' : 'text-gray-800'
          }`}
        >
          {label}
        </span>
        {qty ? (
          <span className="text-eyebrow font-black tabular-nums text-gray-500">×{qty}</span>
        ) : null}
        {tag ? (
          <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wide text-gray-500">
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
