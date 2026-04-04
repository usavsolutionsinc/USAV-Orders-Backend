'use client';

import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  framerPresence,
  framerTransition,
  chipText,
  CardShell,
  ChevronToggle,
  DetailGrid,
  DetailCell,
} from '@/design-system';
import { Check, Settings } from '@/components/Icons';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { PlatformExternalChip } from '@/components/ui/PlatformExternalChip';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { WorkOrderAssignmentCard } from '@/components/work-orders/WorkOrderAssignmentCard';
import { getDaysLateTone } from '@/utils/upnext-helpers';
import { useUpNextRepairCard } from '@/hooks/station/useUpNextRepairCard';
import type { RepairQueueItem } from '@/components/station/upnext/upnext-types';
import { UpNextActionButton } from '@/components/station/upnext/UpNextActionButton';

interface MobileRepairCardProps {
  repair: RepairQueueItem;
  techId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRefresh?: () => void;
}

export function MobileRepairCard({ repair, techId, isExpanded, onToggleExpand, onRefresh }: MobileRepairCardProps) {
  const card = useUpNextRepairCard({ repair, techId, onRefresh });
  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

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
              textClassName="text-[15px] font-black text-blue-700"
              className=""
            />
            <span className={`text-[15px] font-black ${getDaysLateTone(card.daysLate)}`}>
              {card.daysLate}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`${chipText} text-gray-900 px-1.5 py-0.5 rounded border border-gray-300`}>
              #{card.ticketShort}
            </span>
            <PlatformExternalChip
              orderId={card.skuValue}
              accountSource={null}
              canOpen={!!card.getExternalUrlByItemNumber(card.skuValue)}
              onOpen={() => card.openExternalByItemNumber(card.skuValue)}
            />
            <ChevronToggle isExpanded={isExpanded} tone="orange" />
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-3">
          <h4 className="text-[17px] font-black text-gray-900 leading-tight">
            {repair.productTitle || 'Unknown Product'}
          </h4>
        </div>

        {/* ── Issue (always visible) ── */}
        {repair.issue && (
          <div className="mt-2.5 border-t border-orange-100 px-3 pt-2">
            <p className="text-[15px] font-bold text-gray-700 leading-relaxed line-clamp-2">{repair.issue}</p>
          </div>
        )}

        {/* ── Compact action area ── */}
        <div className="mt-2.5 border-t border-orange-100 px-3 pt-2" onClick={stopProp}>
          {card.hasOutOfStock && (
            <OutOfStockField value={repair.outOfStock!} className="mb-2" />
          )}

          {card.hasOutcome && !card.hasOutOfStock && (
            <div className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50/40 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(16,185,129,0.06)]">
              <span className="mb-1 block text-[11px] font-black uppercase tracking-widest text-emerald-700">Repaired Part</span>
              <p className="text-[15px] text-gray-900 break-words leading-snug">{repair.repairOutcome}</p>
            </div>
          )}

          {!card.showOosInput && !card.showRepairedInput && (
            <div className={`grid gap-3 ${!card.hasOutOfStock && !card.hasOutcome ? 'grid-cols-2' : 'grid-cols-1'}`}>
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
                  icon={<Check className="w-4 h-4" />}
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
                    className="w-full resize-none rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-[13px] font-bold leading-relaxed text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] focus:outline-none focus:ring-2 focus:ring-emerald-400 placeholder:text-gray-400"
                    autoFocus
                  />
                  <div className="grid grid-cols-2 gap-3">
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
                <DetailGrid>
                  <DetailCell label="Customer">
                    {card.customerName || 'Unknown'}
                  </DetailCell>
                  <DetailCell label="Phone / Serial">
                    {card.customerPhone || repair.serialNumber || 'None'}
                  </DetailCell>
                  <DetailCell label="Assigned Tech">
                    <div className="flex items-center justify-between gap-1">
                      <span>{repair.techName || (card.isUnassigned ? 'Unassigned' : 'Unknown')}</span>
                      <button
                        onClick={card.openAssignment}
                        className="flex-shrink-0 h-11 w-11 flex items-center justify-center text-gray-400 active:text-orange-600 active:scale-95 transition-transform"
                        aria-label="Open work order assignment"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                    </div>
                  </DetailCell>
                  <DetailCell label="Repair ID">
                    {repair.repairId != null ? String(repair.repairId) : 'Unknown'}
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
