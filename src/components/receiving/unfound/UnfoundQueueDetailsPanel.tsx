'use client';

/**
 * Right-side slide-in details panel for an unfound-queue row.
 *
 * Tabs mirror the receiving-side ReceivingDetailsStack 3-tab pattern:
 *   • Overview — identity, Zendesk handoff, team notes, timing
 *   • Extract  — LLM-extracted fields editor + Zoho compare + Zoho PO# I
 *                uploaded + free-form notes (email_po only)
 *   • Email    — full Gmail body (email_po only)
 *
 * For non-email_po kinds the panel renders only Overview (no tabs).
 *
 * Serial numbers were intentionally cut from this surface — they belong
 * on the receiving workspace where the operator scans them during the
 * unbox step. Surfacing them here implied they were editable from the
 * queue, which they aren't.
 *
 * Delete behavior unchanged from prior version (two-step confirm; hidden
 * for unmatched_receiving with a guidance hint).
 *
 * Thin composition shell: interactive logic lives in
 * {@link useUnfoundDetailsPanel}; the tab bodies + shared primitives are
 * presentational components under `./details-panel/`.
 */

import { motion } from 'framer-motion';
import { ExternalLink, Trash2, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { formatDateTimePST } from '@/utils/date';
import { SlideOverBackdrop } from '@/components/ui/SlideOverBackdrop';
import {
  PaneHeader,
  PaneHeaderIconBadge,
  PaneHeaderLabel,
  PaneHeaderTabs,
} from '@/components/ui/pane-header';
import { useUnfoundDetailsPanel } from './details-panel/useUnfoundDetailsPanel';
import type { DetailsTab, UnfoundQueueDetailsPanelProps } from './details-panel/unfound-details-helpers';
import { OverviewTab } from './details-panel/OverviewTab';
import { ExtractTab } from './details-panel/ExtractTab';
import { EmailTab } from './details-panel/EmailTab';
import { LoadingBlock, ErrorBlock } from './details-panel/details-primitives';

// `UnfoundQueueDetailsRow` moved to ./unfound-triage-types so the hook and this
// panel can share it without importing each other (cycle). Re-exported here.
export type { UnfoundQueueDetailsRow } from './unfound-triage-types';

export function UnfoundQueueDetailsPanel(props: UnfoundQueueDetailsPanelProps) {
  const { row, onClose } = props;
  const c = useUnfoundDetailsPanel(props);
  const { meta, Icon, detailQuery, detail, isEmailPo } = c;

  return (
    <>
      <SlideOverBackdrop onClose={onClose} />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.5 }}
        className="fixed right-0 top-0 z-panel flex h-screen w-[420px] flex-col border-l border-border-soft bg-surface-card shadow-[-20px_0_50px_rgba(0,0,0,0.05)]"
      >
        <PaneHeader
          className="border-border-hairline bg-surface-card/90 backdrop-blur-xl"
          rowClassName="px-6"
          leftSlot={
            <>
              <PaneHeaderIconBadge Icon={Icon} bg={meta.bg} tint="text-white" />
              <PaneHeaderLabel
                eyebrow={
                  <>
                    {meta.label.toUpperCase()}{' '}
                    <span className="text-text-soft">
                      · {formatDateTimePST(row.created_at)}
                    </span>
                  </>
                }
                value={c.identityLabel}
                valueTitle={c.identityLabel}
              />
            </>
          }
          rightSlot={
            <IconButton
              icon={<X className="h-5 w-5" />}
              ariaLabel="Close"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-surface-sunken"
            />
          }
          belowSlot={
            isEmailPo ? (
              <PaneHeaderTabs<DetailsTab>
                tabs={[
                  { value: 'overview', label: 'Overview' },
                  { value: 'extract', label: 'Extract' },
                  { value: 'email', label: 'Email' },
                ]}
                value={c.activeTab}
                onChange={c.setActiveTab}
                className="px-6"
              />
            ) : undefined
          }
        />

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {!isEmailPo || c.activeTab === 'overview' ? (
            <OverviewTab
              row={row}
              subjectPrefix={c.subjectPrefix}
              poNumbers={c.poNumbers}
              pushing={c.pushing}
              onPushToZendesk={c.handlePushToZendesk}
              detail={detail}
            />
          ) : null}

          {isEmailPo && c.activeTab === 'extract' ? (
            detailQuery.isLoading && !detail ? (
              <LoadingBlock />
            ) : detailQuery.error ? (
              <ErrorBlock message={detailQuery.error.message} />
            ) : detail ? (
              <ExtractTab
                detail={detail}
                rowId={row.source_id}
                patchTriage={c.patchTriage}
                onRowUpdated={c.updateTriageRow}
              />
            ) : null
          ) : null}

          {isEmailPo && c.activeTab === 'email' ? (
            detailQuery.isLoading && !detail ? (
              <LoadingBlock />
            ) : detailQuery.error ? (
              <ErrorBlock message={detailQuery.error.message} />
            ) : detail ? (
              <EmailTab detail={detail} />
            ) : null
          ) : null}
        </div>

        {/* Footer — actions row + sticky destructive */}
        <div className="border-t border-border-hairline px-6 py-3">
          <div className="mb-2 flex flex-wrap gap-2">
            {c.externalUrl && c.externalLabel && (
              <a
                href={c.externalUrl}
                target={row.kind === 'email_po' ? '_blank' : undefined}
                rel={row.kind === 'email_po' ? 'noreferrer' : undefined}
                className="inline-flex items-center gap-1.5 rounded-md border border-border-soft px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-text-muted hover:bg-surface-hover"
              >
                <ExternalLink className="h-3 w-3" />
                {c.externalLabel}
              </a>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void c.handleCopyAll()}
              className="rounded-md border border-border-soft px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-text-muted hover:bg-surface-hover"
            >
              Copy details
            </Button>
          </div>
          {c.canHardDelete ? (
            <Button
              variant="danger"
              size="lg"
              icon={<Trash2 />}
              loading={c.deleting}
              onClick={() => void c.handleDelete()}
              className={`w-full rounded-xl text-micro font-black uppercase tracking-wider text-white ${
                c.confirmingDelete
                  ? 'bg-red-700 hover:bg-red-800'
                  : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {c.deleting
                ? 'Deleting…'
                : c.confirmingDelete
                  ? 'Click again to confirm delete'
                  : 'Delete Row'}
            </Button>
          ) : (
            <p className="rounded-xl bg-surface-canvas px-3 py-3 text-center text-micro text-text-soft">
              Unmatched receiving rows can have attached lines. Use the{' '}
              <span className="font-bold text-text-muted">Check</span> toggle
              to clear from the queue, or open the workspace to delete carefully.
            </p>
          )}
        </div>
      </motion.div>
    </>
  );
}
