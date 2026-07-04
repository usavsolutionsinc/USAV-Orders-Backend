'use client';

/**
 * FBA board detail panel — slide-over for one FNSKU's plan entries + scan
 * activity. Thin composition shell: data + fetch live in {@link useFbaBoardDetail};
 * the plan-entry card + armed delete control are presentational components
 * under `./board-detail/`.
 */

import { motion } from 'framer-motion';
import { Check, ClipboardList, Loader2 } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { FnskuChip } from '@/components/ui/CopyChip';
import { PanelActionBar } from '@/components/shipped/details-panel/PanelActionBar';
import { FnskuCatalogInfoPanel } from './FnskuCatalogInfoPanel';
import { SlideOverBackdrop } from '@/components/ui/SlideOverBackdrop';
import { scanActionLabel, formatCreatedAt, type FbaBoardDetailPanelProps } from './board-detail/board-detail-shared';
import { useFbaBoardDetail } from './board-detail/useFbaBoardDetail';
import { PlanEntryCard } from './board-detail/PlanEntryCard';
import { FbaDeleteControl } from './board-detail/FbaDeleteControl';

export function FbaBoardDetailPanel({
  item,
  onClose,
  onNavigate,
  onSaved,
  disableMoveUp = false,
  disableMoveDown = false,
}: FbaBoardDetailPanelProps) {
  const {
    entries, scanLogs, loading,
    setCatalogSnapshot, handleEntryChange, panelActions,
    totalExpected, totalActual, headerTitle,
  } = useFbaBoardDetail({ item, onSaved });

  return (
    <>
      <SlideOverBackdrop onClose={onClose} />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 26, stiffness: 360, mass: 0.45 }}
        className="fixed right-0 top-0 z-panel flex h-screen w-[420px] flex-col overflow-hidden border-l border-border-soft bg-surface-card shadow-[-24px_0_48px_rgba(0,0,0,0.06)]"
      >
      {/* ── Fixed header (4 rows) — never scrolls ──────────────────── */}
      <div className="shrink-0 overflow-hidden bg-surface-card">
        {/* Row 1: label */}
        <div className="px-6 pt-4 pb-0">
          <p className="text-eyebrow font-black uppercase tracking-[0.3em] text-purple-700">
            FBA Item
          </p>
        </div>

        {/* Row 2: title */}
        <div className="px-6 pt-1.5 pb-2 border-b border-border-soft h-[100px]">
          <h2 className="line-clamp-4 text-lg font-black leading-snug tracking-tight text-gray-950">
            {headerTitle}
          </h2>
        </div>

        {/* Row 3: navigation action bar */}
        <div className="pt-1 pb-0">
          <PanelActionBar
            onClose={onClose}
            onMoveUp={() => onNavigate('up')}
            onMoveDown={() => onNavigate('down')}
            disableMoveUp={disableMoveUp}
            disableMoveDown={disableMoveDown}
            actions={panelActions}
          />
        </div>

        {/* Row 4: FNSKU + totals */}
        <div className="flex items-center justify-between px-6 pt-2 pb-2">
          <div className="flex items-center gap-4 text-caption">
            <span className="flex items-center gap-1 font-bold text-text-muted">
              <ClipboardList className="h-3 w-3 text-purple-500" />
              <span className="tabular-nums">{totalExpected}</span>
            </span>
            <span className="flex items-center gap-1 font-bold text-emerald-700">
              <Check className="h-3 w-3 text-emerald-500" />
              <span className="tabular-nums">{totalActual}</span>
            </span>
          </div>
          <FnskuChip value={item.fnsku} />
        </div>
      </div>

      {/* ── Scrollable body ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-4">
          <FnskuCatalogInfoPanel
            fnsku={item.fnsku}
            productTitle={item.display_title}
            condition={item.condition}
            sku={item.sku}
            asin={item.asin}
            sourceKey={item.item_id}
            onCatalogMetaChange={setCatalogSnapshot}
            onCatalogSaved={onSaved}
          />

          <div className="h-px bg-surface-sunken" />

          {/* Static details */}
          <section className="py-4">
            <p className={`mb-2 ${sectionLabel}`}>Details</p>
            <dl className="space-y-1 text-label">
              <div className="flex items-center justify-between gap-4">
                <dt className="font-semibold text-text-soft">Plans</dt>
                <dd className="font-black text-text-default">{entries.length}</dd>
              </div>
            </dl>
          </section>

          <div className="h-px bg-surface-sunken" />

          {/* Plan entries list */}
          <section className="py-4">
            <p className={`mb-3 ${sectionLabel}`}>
              Plan Entries ({entries.length})
            </p>

            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-text-faint" />
              </div>
            ) : entries.length === 0 ? (
              <p className="py-4 text-center text-caption font-bold text-text-faint">
                No active plan entries
              </p>
            ) : (
              <div className="space-y-2">
                {entries.map((entry) => (
                  <PlanEntryCard
                    key={entry.item_id}
                    entry={entry}
                    onQtySaved={handleEntryChange}
                    onDeleted={handleEntryChange}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Scan activity — who scanned this FNSKU and when */}
          <div className="h-px bg-surface-sunken" />
          <section className="py-4">
            <p className={`mb-3 ${sectionLabel}`}>Scan Activity ({scanLogs.length})</p>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-text-faint" />
              </div>
            ) : scanLogs.length === 0 ? (
              <p className="py-2 text-center text-caption font-bold text-text-faint">No scans yet</p>
            ) : (
              <div className="space-y-1.5">
                {scanLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border-hairline bg-surface-canvas/60 px-2.5 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wider bg-purple-100 text-purple-700">
                        {scanActionLabel(log.source_stage, log.event_type)}
                      </span>
                      <span className="truncate text-caption font-bold text-text-muted">
                        {log.staff_name || 'Unknown'}
                      </span>
                    </div>
                    <span className="shrink-0 text-micro font-semibold tabular-nums text-text-faint">
                      {formatCreatedAt(log.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* All tracking numbers across entries */}
          {entries.some((e) => e.tracking_numbers.length > 0) && (
            <>
              <div className="h-px bg-surface-sunken" />
              <section className="py-4">
                <p className={`mb-2 ${sectionLabel}`}>All Tracking</p>
                <div className="space-y-0.5">
                  {Array.from(
                    new Map(
                      entries
                        .flatMap((e) => e.tracking_numbers)
                        .map((t) => [t.tracking_number, t]),
                    ).values(),
                  ).map((t, i) => (
                    <p key={i} className="font-mono text-caption font-bold text-text-muted">
                      {t.carrier && <span className="text-text-soft">{t.carrier} </span>}
                      {t.tracking_number}
                    </p>
                  ))}
                </div>
              </section>
            </>
          )}

          <div className="h-px bg-surface-sunken" />

          {/* Delete all entries for this FNSKU */}
          <section className="py-4">
            <FbaDeleteControl entries={entries} onDeleted={() => { onClose(); onSaved(); }} />
          </section>
        </div>
      </div>
    </motion.div>
    </>
  );
}
