'use client';

import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresence,
  framerTransition,
  chipText,
  CardShell,
  ChevronToggle,
  DetailGrid,
  DetailCell,
  CopyIconButton,
  ExternalLinkButton,
} from '@/design-system';
import { ExternalLink, Package, Settings } from '@/components/Icons';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { InlineQtyPrefix } from '@/components/ui/QtyBadge';
import { WorkOrderAssignmentCard } from '@/components/work-orders/WorkOrderAssignmentCard';
import { useUpNextFbaCard } from '@/hooks/station/useUpNextFbaCard';
import type { FBAQueueItem } from '@/components/station/upnext/upnext-types';

interface MobileFbaItemCardProps {
  item: FBAQueueItem;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function MobileFbaItemCard({ item, isExpanded, onToggleExpand }: MobileFbaItemCardProps) {
  const card = useUpNextFbaCard({ item });

  return (
    <>
      <CardShell
        isExpanded={isExpanded}
        tone="purple"
        onClick={onToggleExpand}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-4 px-3">
          <div className="flex items-center gap-2">
            <ShipByDate
              date={card.displayShipBy || ''}
              showPrefix={false}
              showYear={false}
              icon={Package}
              iconClassName="w-4 h-4 text-purple-600"
              textClassName="text-[15px] font-black text-blue-700"
              className=""
            />
            <span className="text-[15px] font-black tabular-nums text-blue-700">{card.daysLate}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (card.asinUrl) window.open(card.asinUrl, '_blank', 'noopener,noreferrer');
              }}
              disabled={!card.asinUrl}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 px-2 text-gray-900 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 disabled:hover:bg-white disabled:hover:border-gray-300 disabled:hover:text-gray-900 transition-colors"
            >
              <span className={`${chipText} leading-none translate-y-px`}>#{card.fnskuLast4}</span>
              <ExternalLink className="w-3.5 h-3.5 text-blue-300" />
            </button>
            <ChevronToggle isExpanded={isExpanded} tone="purple" />
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-3">
          <h4 className="text-[17px] font-black text-gray-900 leading-tight">
            <InlineQtyPrefix quantity={card.qtyLabel} />
            <span className={card.conditionColor}>{card.conditionLabel}</span>
            {' '}{item.product_title || `FNSKU • ${card.fnskuLast4}`}
          </h4>
        </div>

        {/* ── Expanded details ── */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="expanded-fba-item"
              {...framerPresence.collapseHeight}
              transition={framerTransition.upNextCollapse}
              className="overflow-hidden"
            >
              <div className="mt-3 border-t border-purple-100 px-3 pt-3" onClick={(e) => e.stopPropagation()}>
                <DetailGrid>
                  <DetailCell label="Pending Group">
                    <span className="font-mono break-words">{card.pendingTitle || '—'}</span>
                  </DetailCell>
                  <DetailCell label="Shipment row ID">
                    <span className="tabular-nums">{item.shipment_id}</span>
                  </DetailCell>
                  <DetailCell label="ASIN">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 break-words">{card.asin || 'Not available'}</div>
                      <div className="flex items-center gap-1">
                        <CopyIconButton
                          copied={card.copiedAsin}
                          onClick={card.handleCopyAsin}
                          ariaLabel={card.copiedAsin ? 'ASIN copied' : 'Copy ASIN'}
                        />
                        <ExternalLinkButton
                          onClick={(e) => {
                            e.stopPropagation();
                            if (card.asinUrl) window.open(card.asinUrl, '_blank', 'noopener,noreferrer');
                          }}
                          disabled={!card.asinUrl}
                          ariaLabel="Open ASIN in external tab"
                        />
                      </div>
                    </div>
                  </DetailCell>
                  <DetailCell label="Tech">
                    <div className="flex items-center justify-between gap-1">
                      <span>{item.assigned_tech_name || 'Unassigned'}</span>
                      <button
                        onClick={card.openAssignment}
                        className="flex-shrink-0 h-11 w-11 flex items-center justify-center text-gray-400 active:text-purple-600 active:scale-95 transition-transform"
                        aria-label="Edit assignment"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                    </div>
                  </DetailCell>
                  <DetailCell label="FNSKU">
                    <span className="break-words">{card.fnsku || 'Not available'}</span>
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
