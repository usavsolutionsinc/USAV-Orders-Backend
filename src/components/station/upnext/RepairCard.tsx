'use client';

import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  framerPresence,
  framerTransition,
  fieldLabel,
  dataValue,
  CardShell,
  DetailGrid,
  DetailCell,
} from '@/design-system';
import { Check, Settings } from '@/components/Icons';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { WorkOrderAssignmentCard } from '@/components/work-orders/WorkOrderAssignmentCard';
import { getDaysLateTone } from '@/utils/upnext-helpers';
import { formatMonthDay } from '@/utils/date';
import { useUpNextRepairCard } from '@/hooks/station/useUpNextRepairCard';
import type { RepairQueueItem } from './upnext-types';
import { UpNextActionButton } from './UpNextActionButton';

interface RepairCardProps {
  repair: RepairQueueItem;
  techId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRefresh?: () => void;
}

/**
 * Compact urgency phrase used in the linear row meta line. Repair tickets
 * follow the same urgency vocabulary as orders so the queue reads consistently.
 */
function describeUrgency(daysLate: number | null): string {
  if (daysLate === null) return 'No date';
  if (daysLate > 1) return `${daysLate}d late`;
  if (daysLate === 1) return 'Due today';
  if (daysLate === 0) return 'Due tomorrow';
  return `${Math.abs(daysLate)}d ahead`;
}

export function RepairCard({ repair, techId, isExpanded, onToggleExpand, onRefresh }: RepairCardProps) {
  const card = useUpNextRepairCard({ repair, techId, onRefresh });
  const stopProp = (e: React.MouseEvent) => e.stopPropagation();
  const urgencyText = describeUrgency(card.daysLate);
  const daysLateTone = getDaysLateTone(card.daysLate);

  return (
    <>
      <CardShell
        isSelected={isExpanded}
        tone="orange"
        variant="linear"
        entrance="stagger"
        onClick={onToggleExpand}
      >
        {/* ── Row 1 — ticket id · customer · trailing chevron. ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-caption font-semibold text-gray-500">
            <span className="font-mono font-bold text-orange-700">
              #{card.ticketShort}
            </span>
            <span className="text-gray-300">·</span>
            <span className="truncate text-gray-700">
              {card.customerName || 'Unknown customer'}
            </span>
            {card.isUnassigned && (
              <>
                <span className="text-gray-300">·</span>
                <span className="font-bold text-orange-600">Unassigned</span>
              </>
            )}
          </div>
          <span
            aria-hidden
            className={`flex h-5 w-5 flex-shrink-0 items-center justify-center text-sm leading-none text-gray-400 transition-transform ${
              isExpanded ? 'rotate-90 text-orange-600' : ''
            }`}
          >
            ›
          </span>
        </div>

        {/* ── Row 2 — product title, single-line clamp. ── */}
        <h4 className="mt-0.5 line-clamp-1 text-sm font-semibold leading-snug tracking-tight text-gray-900">
          {repair.productTitle || 'Unknown Product'}
        </h4>

        {/* ── Row 3 — date pill + urgency phrase. ── */}
        <div className="mt-1.5 flex items-center gap-1.5 text-caption">
          <span className="inline-flex items-center rounded-md bg-orange-50 px-1.5 py-0.5 font-bold text-orange-700">
            {formatMonthDay(card.displayDate) || '—'}
          </span>
          <span className={`font-bold tracking-tight ${daysLateTone}`}>
            {urgencyText}
          </span>
        </div>

        {/* ── Issue summary — single line in the collapsed row; full text in
              the expanded section below. ── */}
        {repair.issue && (
          <p className="mt-1.5 line-clamp-1 text-caption font-semibold leading-snug text-gray-600">
            {repair.issue}
          </p>
        )}

        {/* ── Action area + DetailGrid mount only when expanded so collapsed
              rows stay dense. ── */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="repair-expanded"
              {...framerPresence.collapseHeight}
              transition={framerTransition.upNextCollapse}
              className="overflow-hidden"
            >
              <div className="mt-2.5 border-t border-orange-100 pt-2.5" onClick={stopProp}>
                {card.hasOutOfStock && (
                  <OutOfStockField value={repair.outOfStock!} className="mb-2" />
                )}

                {card.hasOutcome && !card.hasOutOfStock && (
                  <div className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50/40 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(16,185,129,0.06)]">
                    <span className="mb-1 block text-micro font-black uppercase tracking-widest text-emerald-700">Repaired Part</span>
                    <p className="text-sm text-gray-900 break-words leading-snug">{repair.repairOutcome}</p>
                  </div>
                )}

                {!card.showOosInput && !card.showRepairedInput && (
                  <div className={`grid gap-2 ${!card.hasOutOfStock && !card.hasOutcome ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {!card.hasOutOfStock && (
                      <UpNextActionButton
                        onClick={(e) => { stopProp(e); card.setShowRepairedInput(false); card.setShowOosInput(true); }}
                        label="Out of Stock"
                        tone="red"
                        fullWidth
                      />
                    )}
                    {!card.hasOutcome && (
                      <UpNextActionButton
                        onClick={(e) => { stopProp(e); card.setShowOosInput(false); card.setShowRepairedInput(true); }}
                        label="Repaired"
                        icon={<Check className="w-3.5 h-3.5" />}
                        tone="emerald"
                        fullWidth
                      />
                    )}
                  </div>
                )}

                {/* Out-of-stock input */}
                <AnimatePresence initial={false}>
                  {card.showOosInput && (
                    <motion.div
                      {...framerPresence.collapseHeight}
                      transition={framerTransition.upNextCollapse}
                      className="overflow-hidden"
                    >
                      <OutOfStockField
                        editable
                        value={card.oosText}
                        onChange={card.setOosText}
                        onCancel={() => { card.setShowOosInput(false); card.setOosText(''); }}
                        onSubmit={card.handleOosSubmit}
                        autoFocus
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Repaired input */}
                <AnimatePresence initial={false}>
                  {card.showRepairedInput && (
                    <motion.div
                      {...framerPresence.upNextRow}
                      transition={framerTransition.upNextRowMount}
                      className="overflow-hidden pt-0.5"
                    >
                      <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.88),inset_0_0_0_1px_rgba(16,185,129,0.06)]">
                        <textarea
                          value={card.outcomeText}
                          onChange={(e) => card.setOutcomeText(e.target.value)}
                          onClick={stopProp}
                          placeholder="What was repaired?"
                          rows={3}
                          className="w-full resize-none rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-xs font-bold leading-relaxed text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] focus:outline-none focus:ring-2 focus:ring-emerald-400 placeholder:text-gray-400"
                          autoFocus
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <UpNextActionButton
                            onClick={(e) => { stopProp(e); card.setShowRepairedInput(false); card.setOutcomeText(''); }}
                            label="Cancel"
                            tone="gray"
                            size="sm"
                            fullWidth
                          />
                          <UpNextActionButton
                            onClick={(e) => { stopProp(e); card.handleRepairedSubmit(); }}
                            disabled={card.repairedSaving}
                            label={card.repairedSaving ? 'Saving…' : 'Mark Repaired'}
                            tone="emerald"
                            size="sm"
                            fullWidth
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Expanded detail grid ── */}
              <div className="mt-2.5 border-t border-orange-200 pt-2.5">
                <DetailGrid className={fieldLabel}>
                  <DetailCell label="Customer">
                    <span className={`${dataValue} text-caption normal-case tracking-normal break-words`}>
                      {card.customerName || 'Unknown'}
                    </span>
                  </DetailCell>
                  <DetailCell label="Phone / Serial">
                    <span className={`${dataValue} text-caption normal-case tracking-normal break-words`}>
                      {card.customerPhone || repair.serialNumber || 'None'}
                    </span>
                  </DetailCell>
                  <DetailCell label="Assigned Tech">
                    <div className="flex items-center justify-between gap-1">
                      <span className={`${dataValue} text-caption normal-case tracking-normal break-words`}>
                        {repair.techName || (card.isUnassigned ? 'Unassigned' : 'Unknown')}
                      </span>
                      <button
                        onClick={card.openAssignment}
                        className="flex-shrink-0 text-gray-400 hover:text-orange-600 transition-colors"
                        aria-label="Open work order assignment"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </DetailCell>
                  <DetailCell label="Repair ID">
                    <span className={`${dataValue} text-caption normal-case tracking-normal break-words`}>
                      {repair.repairId != null ? String(repair.repairId) : 'Unknown'}
                    </span>
                  </DetailCell>
                </DetailGrid>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardShell>

      {/* Assignment overlay */}
      {card.mounted && createPortal(
        <AnimatePresence>
          {card.showAssignment && (
            <WorkOrderAssignmentCard
              rows={[card.workOrderRow]}
              startIndex={0}
              technicianOptions={card.technicianOptions}
              packerOptions={card.packerOptions}
              onConfirm={card.handleAssignConfirm}
              onClose={() => card.setShowAssignment(false)}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
