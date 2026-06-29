'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Barcode,
  Cpu,
  Lock,
  RotateCcw,
  ShieldCheck,
} from '@/components/Icons';
import { ThemedStationScanBar } from '@/components/station/scan-bar';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { SerialChip } from '@/components/ui/CopyChip';
import { Button } from '@/design-system/primitives';
import { conditionLabel } from '@/lib/conditions';
import {
  framerPresence,
  framerTransition,
} from '@/design-system/foundations/motion-framer';
import {
  useMotionPresence,
  useMotionTransition,
} from '@/design-system/foundations/motion-framer-hooks';
import { cn } from '@/utils/_cn';
// Type-only import — see useDataWipeController for why this never bundles the
// server module. The `Record<WipeMethod, …>` below is exhaustiveness-checked
// against the enum, so if WIPE_METHODS ever changes this fails to compile
// rather than silently drifting.
import type { WipeMethod } from '@/lib/tech/recordDataWipe';
import {
  useDataWipeController,
  type ResolvedWipeUnit,
  type WipeOutcome,
} from './useDataWipeController';

/** UI metadata for each erasure method, keyed (and exhaustiveness-locked) to the SoT enum. */
const WIPE_METHOD_META: Record<WipeMethod, { label: string; blurb: string }> = {
  factory_reset: { label: 'Factory Reset', blurb: 'OS-level reset to factory defaults.' },
  secure_erase: { label: 'Secure Erase', blurb: 'Drive-level secure erase (ATA / NVMe sanitize).' },
  crypto_erase: { label: 'Crypto Erase', blurb: 'Destroy the encryption key — instant sanitize.' },
};
// Stable render order (string keys preserve insertion order).
const WIPE_METHOD_ORDER = Object.keys(WIPE_METHOD_META) as WipeMethod[];

interface DataWipeStationProps {
  staffId: string;
  userName: string;
}

const META_CHIP_CLASS =
  'inline-flex items-center rounded bg-gray-50 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-gray-600 ring-1 ring-inset ring-gray-200';

/**
 * Data-Wipe Station — the Station-archetype surface for the secure-erase bench.
 * Focus-locked scan bar pinned above a single active-entity card that replaces
 * on each scan; act-and-clear; big pass/fail outcome; ephemeral selection.
 */
export function DataWipeStation({ staffId, userName }: DataWipeStationProps) {
  const c = useDataWipeController();
  const presence = useMotionPresence(framerPresence.stationCard);
  const transition = useMotionTransition(framerTransition.stationCardMount);

  // Exactly one crossfading region (station.md §9). The key changes only on a
  // genuine state swap so the active card dissolves into the next.
  const regionKey = c.outcome
    ? `outcome-${c.outcome.kind}-${c.outcome.unit.id}`
    : c.activeUnit
      ? `unit-${c.activeUnit.id}`
      : c.errorMessage
        ? 'resolve-error'
        : 'empty';

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Header band — scan bar pinned above the scroll body (never scrolls away). */}
      <div className="border-b border-gray-100">
        <div className="mx-auto w-full max-w-2xl space-y-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-inset ring-blue-200">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1 className="text-caption font-black uppercase leading-none tracking-widest text-gray-900">
                Data Wipe Station
              </h1>
              <p className="mt-1 truncate text-eyebrow font-semibold uppercase leading-none tracking-widest text-gray-400">
                Secure erase · {userName}
              </p>
            </div>
          </div>

          <ThemedStationScanBar
            staffId={staffId}
            value={c.inputValue}
            onChange={c.setInputValue}
            onSubmit={c.handleScan}
            inputRef={c.inputRef}
            placeholder="Scan unit serial or printed label"
            icon={<Barcode className="h-[17px] w-[17px]" />}
            autoFocus
            isResolving={c.isResolving}
          />

          <p className="px-1 text-micro font-bold text-gray-400">
            Scan a device serial or its printed unit label, pick the erasure method, then record{' '}
            <span className="text-emerald-600">Wiped</span> or{' '}
            <span className="text-amber-600">Wipe&nbsp;failed</span>.
          </p>
        </div>
      </div>

      {/* Active-card region — the single crossfading surface. */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={regionKey}
              initial={presence.initial}
              animate={presence.animate}
              exit={presence.exit}
              transition={transition}
            >
              {c.outcome ? (
                <OutcomeCard outcome={c.outcome} />
              ) : c.activeUnit ? (
                <ActiveUnitCard
                  unit={c.activeUnit}
                  wipeMethod={c.wipeMethod}
                  onSelectMethod={c.selectMethod}
                  submittingVerdict={c.submittingVerdict}
                  isSubmitting={c.isSubmitting}
                  errorMessage={c.errorMessage}
                  onSubmit={c.submitWipe}
                />
              ) : c.errorMessage ? (
                <ResolveErrorState
                  message={c.errorMessage}
                  onRetry={() => c.inputRef.current?.focus()}
                />
              ) : (
                <EmptyState />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ── Active unit + method picker + verdict actions ────────────────────────────

function ActiveUnitCard({
  unit,
  wipeMethod,
  onSelectMethod,
  submittingVerdict,
  isSubmitting,
  errorMessage,
  onSubmit,
}: {
  unit: ResolvedWipeUnit;
  wipeMethod: WipeMethod;
  onSelectMethod: (method: WipeMethod) => void;
  submittingVerdict: boolean | null;
  isSubmitting: boolean;
  errorMessage: string | null;
  onSubmit: (success: boolean) => void;
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
          Active Unit
        </p>
        {unit.currentStatus ? (
          <span className={META_CHIP_CLASS}>{unit.currentStatus}</span>
        ) : null}
      </div>

      <div className="space-y-2">
        <h2 className="truncate text-base font-black leading-tight text-gray-900">
          {unit.productTitle || unit.sku || 'Serial unit'}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <SerialChip value={unit.serialNumber} />
          {unit.sku ? <span className={META_CHIP_CLASS}>{unit.sku}</span> : null}
          {unit.conditionGrade ? (
            <span className={META_CHIP_CLASS}>{conditionLabel(unit.conditionGrade, 'compact')}</span>
          ) : null}
          {unit.currentLocation ? (
            <span className={META_CHIP_CLASS}>{unit.currentLocation}</span>
          ) : null}
        </div>
      </div>

      {/* Erasure-method picker — segmented pills over the SoT method enum. */}
      <div className="space-y-1.5">
        <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
          Erasure Method
        </p>
        <div className="flex flex-wrap gap-1.5">
          {WIPE_METHOD_ORDER.map((method) => {
            const selected = method === wipeMethod;
            return (
              <HoverTooltip key={method} label={WIPE_METHOD_META[method].blurb} focusable={false} asChild>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelectMethod(method)}
                  disabled={isSubmitting}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-eyebrow font-black uppercase tracking-widest transition-colors disabled:opacity-60',
                    selected
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/25'
                      : 'bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-200 hover:bg-gray-100',
                  )}
                >
                  <Lock className="h-3 w-3" />
                  {WIPE_METHOD_META[method].label}
                </button>
              </HoverTooltip>
            );
          })}
        </div>
      </div>

      {errorMessage ? (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-caption font-semibold text-rose-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      {/* Verdict actions — big pass/fail, not a toast (station.md §6). */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="primary"
          icon={<ShieldCheck />}
          loading={submittingVerdict === true}
          disabled={isSubmitting}
          onClick={() => onSubmit(true)}
          className="w-full bg-emerald-600 shadow-emerald-600/25 hover:bg-emerald-500 active:bg-emerald-700"
        >
          Wiped
        </Button>
        <Button
          variant="danger"
          icon={<AlertTriangle />}
          loading={submittingVerdict === false}
          disabled={isSubmitting}
          onClick={() => onSubmit(false)}
          className="w-full"
        >
          Wipe failed
        </Button>
      </div>
    </div>
  );
}

// ── Big pass/fail outcome ────────────────────────────────────────────────────

function OutcomeCard({ outcome }: { outcome: WipeOutcome }) {
  const wiped = outcome.kind === 'wiped';
  return (
    <div
      className={cn(
        'rounded-2xl border p-5 shadow-sm',
        wiped ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl text-white',
            wiped ? 'bg-emerald-600' : 'bg-amber-500',
          )}
        >
          {wiped ? <ShieldCheck className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
        </span>
        <div className="min-w-0">
          <p
            className={cn(
              'text-eyebrow font-black uppercase tracking-widest',
              wiped ? 'text-emerald-600' : 'text-amber-600',
            )}
          >
            {wiped ? 'Data wiped' : 'Wipe failed'}
          </p>
          <h2 className="truncate text-lg font-black leading-tight text-gray-900">
            {wiped ? 'Routed to grading' : 'Routed to repair'}
          </h2>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <SerialChip value={outcome.unit.serialNumber} />
        <span className={META_CHIP_CLASS}>{WIPE_METHOD_META[outcome.method].label}</span>
        {outcome.idempotent ? (
          <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-gray-500 ring-1 ring-inset ring-gray-200">
            Already recorded
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-micro font-bold text-gray-400">Clearing for the next scan…</p>
    </div>
  );
}

// ── Empty / resolve-error teaching states ────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-10 text-center">
      <Cpu className="mx-auto h-6 w-6 text-gray-300" />
      <p className="mt-3 text-caption font-bold text-gray-600">Scan a unit to begin a secure wipe</p>
      <p className="mt-1 text-eyebrow font-semibold uppercase tracking-widest text-gray-400">
        Device serial or printed unit label
      </p>
    </div>
  );
}

function ResolveErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50 px-4 py-8 text-center">
      <AlertTriangle className="mx-auto h-6 w-6 text-rose-400" />
      <p className="mt-3 text-caption font-bold text-rose-700">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-eyebrow font-black uppercase tracking-widest text-rose-700 ring-1 ring-inset ring-rose-200 transition-colors hover:bg-rose-50"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Scan again
      </button>
    </div>
  );
}
