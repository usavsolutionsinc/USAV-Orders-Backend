'use client';

import { type ReactNode, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Voicemail, Link2, Clock } from '@/components/Icons';
import { EmptyState } from '@/design-system/primitives';
import { SkeletonList } from '@/design-system/components/Skeletons';
import { SearchBar } from '@/components/ui/SearchBar';
import { SidebarNavOverlaySlider } from '@/components/sidebar/SidebarNavOverlaySlider';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { cn } from '@/utils/_cn';
import {
  VOICEMAIL_STATUS_ITEMS,
  type VoicemailStatusFilter,
} from '@/components/sidebar/support/support-sidebar-shared';
import {
  VOICEMAIL_STATUS_LABEL,
  VOICEMAIL_STATUS_TONE,
  displayCounterparty,
  displayNumber,
  formatDuration,
  timeAgo,
  type VoicemailListItem,
} from './voice-presentation';
import { isNotConfigured, useVoicemails } from './useVoiceQueries';

/**
 * Voicemail mode — the Workbench picker. A searchable, status-filtered to-do
 * list of voicemails / missed calls; selecting one writes `?vm=<id>` (durable,
 * deep-linkable) and the page body renders {@link VoicemailDetail}. One-row
 * anatomy: caller → time·mailbox meta → status dot + linked-ticket chip.
 */
export function VoicemailQueue({ modeToggle = null }: { modeToggle?: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = Number(searchParams.get('vm')) || null;

  const [status, setStatus] = useState<VoicemailStatusFilter>('open');
  const [text, setText] = useState('');

  const { data, isLoading, isFetching, error } = useVoicemails({ status, query: text.trim() });
  const notConfigured = isNotConfigured(error);
  const items = data?.items ?? [];
  const nowMs = Date.now();

  const select = (id: number) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('mode', 'voicemail');
    sp.set('vm', String(id));
    router.push(`/support?${sp.toString()}`);
  };

  const openCount = data?.openCount ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-card">
      <div className="shrink-0 px-2 pt-2">
        <SearchBar
          value={text}
          onChange={setText}
          onClear={() => setText('')}
          placeholder="Search caller, number, transcript…"
          variant="blue"
          size="compact"
          isSearching={isFetching && !isLoading}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {modeToggle}
        <SidebarNavOverlaySlider
          items={VOICEMAIL_STATUS_ITEMS}
          value={status}
          onChange={(id) => setStatus(id as VoicemailStatusFilter)}
          aria-label="Voicemail follow-up status"
        />
        {isLoading ? (
          <SkeletonList count={6} />
        ) : notConfigured ? (
          <div className="p-6">
            <EmptyState
              title="Voicemail isn’t connected yet"
              description="Connect Nextiva in Settings → Integrations to start receiving call-back follow-ups here."
            />
          </div>
        ) : error ? (
          <div className="p-6">
            <EmptyState title="Couldn’t load voicemails" description="Please try again." />
          </div>
        ) : items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={status === 'open' ? 'Inbox zero' : 'Nothing here'}
              description={
                status === 'open'
                  ? 'No open voicemails need a call back. Nice work.'
                  : 'No voicemails match this filter.'
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border-hairline">
            {items.map((vm) => (
              <VoicemailRow
                key={vm.id}
                vm={vm}
                selected={vm.id === selectedId}
                nowMs={nowMs}
                onSelect={() => select(vm.id)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-border-hairline px-3 py-2 text-micro font-bold uppercase tracking-widest text-text-faint">
        <Voicemail className="h-3 w-3" />
        {openCount > 0 ? `${openCount} open follow-up${openCount === 1 ? '' : 's'}` : 'Follow-up queue'}
      </div>
    </div>
  );
}

function VoicemailRow({
  vm,
  selected,
  nowMs,
  onSelect,
}: {
  vm: VoicemailListItem;
  selected: boolean;
  nowMs: number;
  onSelect: () => void;
}) {
  const tone = VOICEMAIL_STATUS_TONE[vm.followupStatus];
  const name = displayCounterparty(vm);
  const number = vm.matchedCustomerName ? displayNumber(vm) : '';
  const meta = useMemo(() => {
    const bits = [timeAgo(vm.leftAt, nowMs)];
    if (vm.durationSeconds) bits.push(formatDuration(vm.durationSeconds));
    if (vm.mailbox) bits.push(vm.mailbox);
    return bits.filter(Boolean).join(' · ');
  }, [vm.leftAt, vm.durationSeconds, vm.mailbox, nowMs]);

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'ds-raw-button flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors',
          selected ? 'bg-blue-50 ring-1 ring-inset ring-blue-400' : 'hover:bg-surface-hover',
        )}
      >
        <HoverTooltip label={VOICEMAIL_STATUS_LABEL[vm.followupStatus]} asChild focusable={false}>
          <span
            className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', tone.dot)}
            aria-hidden
          />
        </HoverTooltip>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-label font-bold text-text-default',
                !vm.isRead && 'after:ml-1 after:inline-block after:h-1.5 after:w-1.5 after:rounded-full after:bg-blue-500 after:align-middle',
              )}
            >
              {name}
            </span>
            {vm.linkedTicketId ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-violet-50 px-1 py-0.5 text-[8.5px] font-black uppercase tracking-widest text-violet-700 ring-1 ring-inset ring-violet-200">
                <Link2 className="h-2.5 w-2.5" />#{vm.linkedTicketId}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center gap-1 truncate text-micro font-semibold uppercase tracking-widest text-text-soft">
            <Clock className="h-2.5 w-2.5 shrink-0 text-text-faint" />
            {meta}
            {number ? <span className="text-text-faint">· {number}</span> : null}
          </span>
          {vm.transcriptPreview ? (
            <span className="mt-1 block truncate text-caption leading-4 text-text-soft">
              “{vm.transcriptPreview}”
            </span>
          ) : null}
          {vm.assignedStaffName ? (
            <span className={cn('mt-1 inline-block rounded px-1 py-0.5 text-[8.5px] font-black uppercase tracking-widest ring-1 ring-inset', tone.chip)}>
              {vm.assignedStaffName}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
