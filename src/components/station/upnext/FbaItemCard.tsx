'use client';

import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresence,
  framerTransition,
  fieldLabel,
  dataValue,
  monoValue,
  CardShell,
  DetailGrid,
  DetailCell,
  CopyIconButton,
  ExternalLinkButton,
  IconButton,
} from '@/design-system';
import { ExternalLink, Settings } from '@/components/Icons';
import { InlineQtyPrefix } from '@/components/ui/QtyBadge';
import { WorkOrderAssignmentCard } from '@/components/work-orders/WorkOrderAssignmentCard';
import { getDaysLateTone } from '@/utils/upnext-helpers';
import { formatMonthDay } from '@/utils/date';
import { useUpNextFbaCard } from '@/hooks/station/useUpNextFbaCard';
import type { FBAQueueItem } from './upnext-types';

interface FbaItemCardProps {
  item: FBAQueueItem;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

/**
 * Compact urgency phrase used in the linear row meta line. Matches the
 * vocabulary used by OrderCard and RepairCard.
 */
function describeUrgency(daysLate: number | null | undefined): string {
  if (daysLate == null) return 'No date';
  if (daysLate > 1) return `${daysLate}d late`;
  if (daysLate === 1) return 'Due today';
  if (daysLate === 0) return 'Due tomorrow';
  return `${Math.abs(daysLate)}d ahead`;
}

export function FbaItemCard({ item, isExpanded, onToggleExpand }: FbaItemCardProps) {
  const card = useUpNextFbaCard({ item });
  const urgencyText = describeUrgency(card.daysLate as number | null);
  const daysLateTone = getDaysLateTone(card.daysLate as number | null);
  const canOpenAsin = !!card.asinUrl;

  return (
    <>
      <CardShell
        isSelected={isExpanded}
        tone="purple"
        variant="linear"
        entrance="stagger"
        onClick={onToggleExpand}
      >
        {/* ── Row 1 — FNSKU id · pending group · trailing chevron. ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-caption font-semibold text-gray-500">
            {canOpenAsin ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (card.asinUrl) window.open(card.asinUrl, '_blank', 'noopener,noreferrer');
                }}
                className="ds-raw-button inline-flex items-center gap-1 rounded font-mono font-bold text-purple-700 hover:text-blue-600"
                aria-label="Open FBA item on Amazon"
              >
                #{card.fnskuLast4}
                <ExternalLink className="h-3 w-3 text-gray-300 group-hover:text-blue-400" />
              </button>
            ) : (
              <span className="font-mono font-bold text-purple-700">
                #{card.fnskuLast4}
              </span>
            )}
            <span className="text-gray-300">·</span>
            <span className="truncate text-gray-700">
              {card.pendingTitle || item.shipment_ref || 'FBA item'}
            </span>
          </div>
          <span
            aria-hidden
            className={`flex h-5 w-5 flex-shrink-0 items-center justify-center text-sm leading-none text-gray-400 transition-transform ${
              isExpanded ? 'rotate-90 text-purple-600' : ''
            }`}
          >
            ›
          </span>
        </div>

        {/* ── Row 2 — title (clamp-1) with qty + condition inline. ── */}
        <h4 className="mt-0.5 line-clamp-1 text-sm font-semibold leading-snug tracking-tight text-gray-900">
          <InlineQtyPrefix quantity={card.qtyLabel} />
          {card.conditionLabel && (
            <>
              <span className={card.conditionColor}>{card.conditionLabel}</span>{' '}
            </>
          )}
          {card.strippedTitle || `FNSKU • ${card.fnskuLast4}`}
        </h4>

        {/* ── Row 3 — ship-by pill + urgency phrase + qty pill. ── */}
        <div className="mt-1.5 flex items-center gap-1.5 text-caption">
          <span className="inline-flex items-center rounded-md bg-purple-50 px-1.5 py-0.5 font-bold text-purple-700">
            {formatMonthDay(card.displayShipBy) || '—'}
          </span>
          <span className={`font-bold tracking-tight ${daysLateTone}`}>
            {urgencyText}
          </span>
          <span className="ml-auto rounded bg-amber-100 px-1.5 font-mono text-micro font-bold text-amber-700">
            ×{card.qtyLabel}
          </span>
        </div>

        {/* ── Expanded detail tray ── */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="expanded-fba-item"
              {...framerPresence.collapseHeight}
              transition={framerTransition.upNextCollapse}
              className="overflow-hidden"
            >
              <div className="mt-2.5 border-t border-purple-100 pt-2.5" onClick={(e) => e.stopPropagation()}>
                <DetailGrid className={fieldLabel}>
                  <DetailCell label="Pending Group">
                    <span className={`${monoValue} text-caption normal-case tracking-normal break-words`}>
                      {card.pendingTitle || '—'}
                    </span>
                  </DetailCell>
                  <DetailCell label="Shipment row ID">
                    <span className={`${dataValue} text-caption tabular-nums normal-case tracking-normal`}>
                      {item.shipment_id}
                    </span>
                  </DetailCell>
                  <DetailCell label="ASIN">
                    <div className="flex items-center justify-between gap-2">
                      <div className={`min-w-0 ${dataValue} text-caption normal-case tracking-normal break-words`}>
                        {card.asin || 'Not available'}
                      </div>
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
                      <span className={`${dataValue} text-caption normal-case tracking-normal`}>
                        {item.assigned_tech_name || 'Unassigned'}
                      </span>
                      <IconButton
                        icon={<Settings className="w-3.5 h-3.5 text-gray-400 group-hover:text-purple-600" />}
                        ariaLabel="Edit assignment"
                        onClick={card.openAssignment}
                        className="group flex-shrink-0"
                      />
                    </div>
                  </DetailCell>
                  <DetailCell label="FNSKU">
                    <span className={`${dataValue} text-caption normal-case tracking-normal break-words`}>
                      {card.fnsku || 'Not available'}
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
