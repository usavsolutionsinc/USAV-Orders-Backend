'use client';

/**
 * Repair details slide-over — thin composition shell. All interactive logic
 * (ticket / notes / status edits, linkage set/clear, soft-cancel delete, pickup
 * toggle) lives in {@link useRepairDetailsPanel}; the status / info / linkage
 * sections are presentational components under `./details-panel/`.
 */

import { createPortal } from 'react-dom';
import { Clock, Pencil } from '../Icons';
import { RepairPickupFlow } from '@/components/repair/RepairPickupFlow';
import { DetailStackRailRegistrar } from '@/components/right-rail/DetailStackRailRegistrar';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import DeleteButton from '@/components/ui/DeleteButton';
import { IconButton } from '@/design-system/primitives';
import {
  PaneHeader,
  PaneHeaderActionBar,
  PaneHeaderCloseButton,
  PaneHeaderIconBadge,
  PaneHeaderLabel,
  PaneHeaderStatusPill,
  PaneHeaderTabs,
} from '@/components/ui/pane-header';
import {
  REPAIR_TABS,
  type RepairDetailsPanelProps,
} from './details-panel/repair-details-shared';
import { useRepairDetailsPanel } from './details-panel/useRepairDetailsPanel';
import { RepairLinkageSection } from './details-panel/RepairLinkageSection';
import { RepairOverviewTab } from './details-panel/RepairOverviewTab';
import { ShippedNotesComposer } from '@/components/shipped/details-panel/ShippedNotesComposer';

function getRepairStatusTone(status: string | null | undefined) {
  if (!status) return 'neutral' as const;
  if (status === 'Done') return 'emerald' as const;
  if (status.includes('Awaiting')) return 'amber' as const;
  if (status.includes('Pending')) return 'blue' as const;
  return 'neutral' as const;
}

export function RepairDetailsPanel({
  repair,
  onClose,
  onUpdate,
  onMoveUp = () => {},
  onMoveDown = () => {},
  disableMoveUp = false,
  disableMoveDown = false,
}: RepairDetailsPanelProps) {
  const c = useRepairDetailsPanel({ repair, onUpdate });
  const hasSavedNotes = String(repair.notes || '').trim().length > 0;

  return (
    <DetailStackRailRegistrar id={`detail:claim:${repair.id}`} onClose={onClose}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <PaneHeader
          className="border-border-hairline bg-surface-card/90 backdrop-blur-xl"
          rowClassName="px-6"
          leftSlot={
            <>
              <PaneHeaderIconBadge Icon={Clock} bg="bg-orange-100" tint="text-orange-600" />
              <PaneHeaderLabel
                eyebrow={c.isSavingTicket ? 'Saving ticket...' : 'Repair ticket'}
                value={
                  c.isEditingTicket ? (
                    <input
                      ref={c.ticketInputRef}
                      type="text"
                      value={c.ticketNumber}
                      onChange={(e) => c.setTicketNumber(e.target.value)}
                      onBlur={c.handleSaveTicket}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur();
                        }
                        if (e.key === 'Escape') {
                          c.setTicketNumber(repair.ticket_number || '');
                          c.setIsEditingTicket(false);
                        }
                      }}
                      className="w-full border-none bg-transparent p-0 text-sm font-black uppercase tracking-tight text-text-default focus:ring-0"
                      placeholder="TK Number"
                      disabled={c.isSavingTicket}
                    />
                  ) : c.zendeskTicketUrl ? (
                    <HoverTooltip label={`Open Zendesk ticket ${c.ticketNumber}`} asChild>
                      <a
                        href={c.zendeskTicketUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate transition-colors hover:text-blue-600"
                      >
                        {c.ticketNumber}
                      </a>
                    </HoverTooltip>
                  ) : (
                    <span className="text-text-faint">TK Number</span>
                  )
                }
                valueTitle={c.ticketNumber || 'TK Number'}
              />
            </>
          }
          rightSlot={
            <>
              <IconButton
                icon={<Pencil className="h-4 w-4" />}
                onClick={() => c.setIsEditingTicket(true)}
                ariaLabel="Edit ticket number"
                disabled={c.isSavingTicket}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface-sunken"
              />
              <PaneHeaderCloseButton onClick={onClose} ariaLabel="Close repair details" />
            </>
          }
          belowSlot={
            <>
              <div className="flex flex-wrap items-center gap-2 px-6 pb-2">
                <PaneHeaderStatusPill
                  tone={getRepairStatusTone(repair.status)}
                  pulse
                  className={
                    repair.status === 'Repaired, Contact Customer'
                      ? 'text-micro tracking-[0.14em]'
                      : undefined
                  }
                >
                  {repair.status || 'No status'}
                </PaneHeaderStatusPill>
              </div>
              <div className="px-6 py-2">
                <PaneHeaderActionBar
                  iconOnly
                  variant="card"
                  actions={c.panelActions.map((action) => ({
                    key: action.key,
                    label: action.label,
                    icon: <span className={action.toneClassName}>{action.icon}</span>,
                    onClick: action.onAction,
                  }))}
                  onPrev={onMoveUp}
                  onNext={onMoveDown}
                  prevDisabled={disableMoveUp}
                  nextDisabled={disableMoveDown}
                  prevTitle="Move up a row"
                  nextTitle="Move down a row"
                />
              </div>
              <PaneHeaderTabs
                tabs={REPAIR_TABS}
                value={c.activeTab}
                onChange={c.setActiveTab}
                className="px-6"
              />
            </>
          }
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {c.activeTab === 'overview' ? <RepairOverviewTab repair={repair} c={c} /> : null}
          {c.activeTab === 'links' ? <RepairLinkageSection c={c} /> : null}
        </div>

        <div className="shrink-0 bg-surface-card pb-8">
          {(c.isEditingNotes || hasSavedNotes) ? (
            c.isEditingNotes ? (
              <ShippedNotesComposer
                value={c.notes}
                onChange={c.setNotes}
                onCancel={() => {
                  c.setNotes(repair.notes || '');
                  c.setIsEditingNotes(false);
                }}
                onSubmit={c.handleSaveNotes}
                isSaving={c.isSaving}
              />
            ) : (
              <ShippedNotesComposer
                value={String(repair.notes || '')}
                readOnly
                onClick={() => c.setIsEditingNotes(true)}
              />
            )
          ) : null}
          <section className="mx-8 pt-2">
            <DeleteButton
              onConfirm={c.handleDelete}
              onDeleted={onClose}
              label="Delete"
              armedLabel="Click Again To Confirm"
              className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 text-white text-micro font-black uppercase tracking-wider transition hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </section>
        </div>

        {c.isMounted && c.showPickupFlow
          ? createPortal(
              <RepairPickupFlow
                repair={repair}
                onUpdate={onUpdate}
                onClose={() => c.setShowPickupFlow(false)}
              />,
              document.body,
            )
          : null}
      </div>
    </DetailStackRailRegistrar>
  );
}
