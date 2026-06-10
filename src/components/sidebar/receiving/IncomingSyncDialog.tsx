'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, Check, Loader2, Mail, RefreshCw, X } from '@/components/Icons';
import { framerTransition } from '@/design-system/foundations/motion-framer';
import { sectionLabel, fieldLabel, microBadge, dataValue } from '@/design-system/tokens/typography/presets';

export type IncomingSyncKind = 'zoho' | 'email';

export interface SyncDialogTile {
  label: string;
  value: number;
  tone: 'emerald' | 'blue' | 'gray' | 'red';
}

export interface SyncDialogSection {
  label: string;
  /** "field: value" rows shown as a small key/value grid. */
  rows: Array<{ k: string; v: string | number }>;
}

export interface IncomingSyncResult {
  ok: boolean;
  tiles: SyncDialogTile[];
  sections: SyncDialogSection[];
  /** Carrier-style "what changed" bullets — the headline outcomes. */
  updated: string[];
  /** Error messages to list (e.g. Zoho mirror errors), if any. */
  errors: string[];
  /** Shown when nothing changed, or the failure message. */
  note: string | null;
}

interface IncomingSyncDialogProps {
  open: boolean;
  kind: IncomingSyncKind;
  isRunning: boolean;
  elapsedMs: number;
  result: IncomingSyncResult | null;
  onClose: () => void;
}

const KIND_META: Record<IncomingSyncKind, { eyebrow: string; icon: typeof RefreshCw; runningTitle: string }> = {
  zoho: { eyebrow: 'Zoho Sync', icon: RefreshCw, runningTitle: 'Refreshing Zoho POs' },
  email: { eyebrow: 'Email Sync', icon: Mail, runningTitle: 'Rescanning PO mailbox' },
};

const TONE_MAP = {
  emerald: 'border-emerald-200 bg-emerald-50/60 text-emerald-700',
  blue: 'border-blue-200 bg-blue-50/60 text-blue-700',
  gray: 'border-gray-200 bg-gray-50/60 text-gray-700',
  red: 'border-red-200 bg-red-50/60 text-red-700',
} as const;

function SummaryStat({ label, value, tone }: SyncDialogTile) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${TONE_MAP[tone]}`}>
      <p className={microBadge}>{label}</p>
      <p className={`${dataValue} mt-0.5 tabular-nums text-xl`}>{value}</p>
    </div>
  );
}

/**
 * Result dialog for the Incoming toolbar's Zoho / Email sync buttons —
 * the single-shot (non-streaming) sibling of CarrierSyncDialog. Same visual
 * language (portal overlay, eyebrow + title header, summary stat tiles,
 * breakdown sections, footer) so all three sync actions feel consistent.
 */
export function IncomingSyncDialog({
  open,
  kind,
  isRunning,
  elapsedMs,
  result,
  onClose,
}: IncomingSyncDialogProps) {
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalNode(document.body);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isRunning) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isRunning, onClose]);

  if (!portalNode || !open) return null;

  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const title = isRunning
    ? meta.runningTitle
    : result?.ok === false
      ? 'Sync failed'
      : 'Sync complete';

  const overlay = (
    <motion.div
      key="incoming-sync-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={framerTransition.overlayScrim}
      className="fixed inset-0 z-panelPopover flex items-center justify-center bg-gray-950/40 px-4 py-6"
      onClick={() => {
        if (!isRunning) onClose();
      }}
    >
      <motion.div
        key="incoming-sync-card"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320, mass: 0.55 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_80px_-20px_rgba(15,23,42,0.35)] ring-1 ring-gray-200"
      >
        <header className="flex items-start gap-3 border-b border-gray-200 px-5 py-3.5">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Icon className={`h-4 w-4 ${kind === 'zoho' ? 'text-emerald-600' : 'text-violet-600'} ${isRunning ? 'animate-pulse' : ''}`} />
            <div className="min-w-0">
              <p className={`${microBadge} text-gray-500`}>{meta.eyebrow}</p>
              <h2 className={`${sectionLabel} text-gray-900 mt-0.5`}>{title}</h2>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <motion.span
              key={Math.floor(elapsedMs / 100)}
              initial={{ opacity: 0.4 }}
              animate={{ opacity: 1 }}
              className={`text-caption font-mono font-semibold tabular-nums ${kind === 'zoho' ? 'text-emerald-600' : 'text-violet-600'}`}
            >
              {(elapsedMs / 1000).toFixed(1)}s
            </motion.span>
            <button
              type="button"
              onClick={onClose}
              disabled={isRunning}
              className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isRunning || !result ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              <p className={fieldLabel}>{meta.runningTitle}…</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {result.tiles.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {result.tiles.map((t) => (
                    <SummaryStat key={t.label} {...t} />
                  ))}
                </div>
              ) : null}

              {/* Headline "what changed" bullets. */}
              {result.updated.length > 0 ? (
                <ul className="space-y-1">
                  {result.updated.map((line, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm font-semibold text-gray-700">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span className="tabular-nums">{line}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {/* Per-leg breakdown (Issued sync / Mirror sync / Scan). */}
              {result.sections.map((s) => (
                <div key={s.label} className="overflow-hidden rounded-xl border border-gray-200">
                  <div className="border-b border-gray-100 bg-gray-50 px-3 py-1.5">
                    <p className={`${microBadge} text-gray-500`}>{s.label}</p>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-3 py-2.5 sm:grid-cols-3">
                    {s.rows.map((r) => (
                      <div key={r.k} className="flex items-baseline justify-between gap-2">
                        <dt className={`${fieldLabel} text-gray-500`}>{r.k}</dt>
                        <dd className="text-sm font-bold tabular-nums text-gray-900">{r.v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}

              {/* Error list (e.g. Zoho mirror errors). */}
              {result.errors.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-red-200 bg-red-50/60">
                  <div className="flex items-center gap-1.5 border-b border-red-100 px-3 py-1.5 text-red-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <p className={microBadge}>Errors</p>
                  </div>
                  <ul className="max-h-40 space-y-1 overflow-y-auto px-3 py-2">
                    {result.errors.map((e, i) => (
                      <li key={i} className="text-[11px] font-medium text-red-700">{e}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.note ? (
                <p className={`text-sm font-semibold ${result.ok ? 'text-gray-500' : 'text-red-600'}`}>
                  {result.note}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-5 py-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isRunning}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {isRunning ? 'Running…' : 'Close'}
          </button>
        </footer>
      </motion.div>
    </motion.div>
  );

  return createPortal(overlay, portalNode);
}
