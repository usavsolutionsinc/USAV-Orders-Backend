'use client';

import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  framerPresence,
  framerTransition,
  cardTitle,
  fieldLabel,
  dataValue,
  CardShell,
  ChevronToggle,
  DetailGrid,
  DetailCell,
} from '@/design-system';
import { Check, Settings } from '@/components/Icons';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { WorkOrderAssignmentCard } from '@/components/work-orders/WorkOrderAssignmentCard';
import { getDaysLateTone } from '@/utils/upnext-helpers';
import { useUpNextRepairCard } from '@/hooks/station/useUpNextRepairCard';
import type { RepairQueueItem } from './upnext-types';
import { UpNextActionButton } from './UpNextActionButton';
import { UpNextHeaderExternalLinkChip } from './UpNextHeaderExternalLinkChip';

interface RepairCardProps {
  repair: RepairQueueItem;
  techId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRefresh?: () => void;
}

export function RepairCard({ repair, techId, isExpanded, onToggleExpand, onRefresh }: RepairCardProps) {
  const card = useUpNextRepairCard({ repair, techId, onRefresh });
  const stopProp = (e: React.MouseEvent) => e.stopPropagation();
  const externalSkuUrl = card.getExternalUrlByItemNumber(card.skuValue);

  return (
    <>
      <CardShell
        isExpanded={isExpanded}
        tone="orange"
        onClick={onToggleExpand}
        className={card.isUnassigned && !isExpanded ? 'border-orange-400' : ''}
      >
        {/* ── Header ── */}
        <div className="mb-3 flex items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <ShipByDate
              date={card.displayDate}
              showPrefix={false}
              showYear={false}
              icon={Settings}
              iconClassName="w-4 h-4 text-orange-600"
              textClassName="text-[14px] font-black text-blue-700"
              className=""
            />
            <span className={`text-[14px] font-black ${getDaysLateTone(card.daysLate)}`}>
              {card.daysLate}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <UpNextHeaderExternalLinkChip
              label={`#${card.ticketShort}`}
              canOpen={!!externalSkuUrl}
              onOpen={() => card.openExternalByItemNumber(card.skuValue)}
              ariaLabel="Open repair item in external page"
            />
            <ChevronToggle isExpanded={isExpanded} tone="orange" />
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-3">
          <h4 className={cardTitle}>
            {repair.productTitle || 'Unknown Product'}
          </h4>
        </div>

        {/* ── Issue (always visible) ── */}
        {repair.issue && (
          <div className="mt-2.5 border-t border-orange-100 px-3 pt-2">
            <p className="text-sm font-bold text-gray-700 leading-relaxed line-clamp-2">{repair.issue}</p>
          </div>
        )}

        {/* ── Compact action area ── */}
        <div className="mt-2.5 border-t border-orange-100 px-3 pt-2" onClick={stopProp}>
          {card.hasOutOfStock && (
            <OutOfStockField value={repair.outOfStock!} className="mb-2" />
          )}

          {card.hasOutcome && !card.hasOutOfStock && (
            <div className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50/40 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(16,185,129,0.06)]">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-emerald-700">Repaired Part</span>
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

        {/* ── Expanded details ── */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="expanded-repair"
              {...framerPresence.collapseHeight}
              transition={framerTransition.upNextCollapse}
              className="overflow-hidden"
            >
              <div className="mt-2.5 border-t border-orange-200 px-3 pt-2.5">
                <DetailGrid className={fieldLabel}>
                  <DetailCell label="Customer">
                    <span className={`${dataValue} text-[11px] normal-case tracking-normal break-words`}>
                      {card.customerName || 'Unknown'}
                    </span>
                  </DetailCell>
                  <DetailCell label="Phone / Serial">
                    <span className={`${dataValue} text-[11px] normal-case tracking-normal break-words`}>
                      {card.customerPhone || repair.serialNumber || 'None'}
                    </span>
                  </DetailCell>
                  <DetailCell label="Assigned Tech">
                    <div className="flex items-center justify-between gap-1">
                      <span className={`${dataValue} text-[11px] normal-case tracking-normal break-words`}>
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
                    <span className={`${dataValue} text-[11px] normal-case tracking-normal break-words`}>
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
