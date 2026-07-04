'use client';

import { useMemo } from 'react';
import {
  ChevronLeft,
  Phone,
  Voicemail,
  Check,
  Clock,
  Link2,
  ExternalLink,
  Loader2,
  User,
} from '@/components/Icons';
import { Button, EmptyState, IconButton } from '@/design-system/primitives';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { cn } from '@/utils/_cn';
import { formatPhoneNumber } from '@/utils/phone';
import {
  VOICEMAIL_STATUS_LABEL,
  VOICEMAIL_STATUS_TONE,
  displayCounterparty,
  formatDuration,
  timeAgo,
} from './voice-presentation';
import { isNotConfigured, useClickToCall, useUpdateFollowup, useVoicemailDetail } from './useVoiceQueries';

/**
 * Voicemail mode — the Workbench right pane. Read view (audio + transcript +
 * matched customer + linked case) plus the action row: Call back, Mark done,
 * Snooze, Create ticket. Each sub-resource degrades to empty rather than
 * crashing the pane. The crossfade between voicemails is owned by the parent
 * (SupportWorkspace), keyed on `?vm` — this component just renders the record.
 */
export function VoicemailDetail({ voicemailId, onBack }: { voicemailId: number; onBack: () => void }) {
  const { data, isLoading, error } = useVoicemailDetail(voicemailId);
  const followup = useUpdateFollowup(voicemailId);
  const call = useClickToCall();
  const nowMs = Date.now();

  const number = data?.fromNumber ?? data?.counterparty ?? null;

  const snoozeTomorrow = useMemo(() => {
    const d = new Date(nowMs + 24 * 60 * 60 * 1000);
    return d.toISOString();
  }, [nowMs]);

  if (isLoading) {
    return (
      <CenteredPane>
        <span className="inline-flex items-center gap-2 text-caption font-semibold text-text-soft">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading voicemail…
        </span>
      </CenteredPane>
    );
  }

  if (isNotConfigured(error)) {
    return (
      <CenteredPane>
        <EmptyState
          icon={<Voicemail className="h-6 w-6 text-text-faint" />}
          title="Voicemail isn’t connected"
          description="Connect Nextiva in Settings → Integrations to play voicemails and work call-back follow-ups."
        />
      </CenteredPane>
    );
  }

  if (error || !data) {
    return (
      <CenteredPane>
        <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center">
          <p className="text-caption font-semibold text-rose-700">Couldn’t load this voicemail.</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="mt-2 h-auto px-0 text-eyebrow font-bold uppercase tracking-widest text-rose-600 hover:text-rose-700"
          >
            Back to the list
          </Button>
        </div>
      </CenteredPane>
    );
  }

  const tone = VOICEMAIL_STATUS_TONE[data.followupStatus];
  const name = displayCounterparty(data);
  const isDone = data.followupStatus === 'done';

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-card">
      {/* Header */}
      <header className="flex shrink-0 items-start gap-3 border-b border-border-hairline px-5 py-3.5">
        <IconButton
          icon={<ChevronLeft className="h-5 w-5" />}
          onClick={onBack}
          ariaLabel="Back to voicemails"
          className="-ml-1.5 mt-0.5 shrink-0 rounded-md p-1 text-text-faint hover:bg-surface-sunken hover:text-text-muted md:hidden"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-black tracking-tight text-text-default">{name}</h1>
            <span className={cn('inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset', tone.chip)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} aria-hidden />
              {VOICEMAIL_STATUS_LABEL[data.followupStatus]}
            </span>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
            {number ? formatPhoneNumber(number) : 'Unknown number'}
            <span className="text-text-faint">·</span>
            {timeAgo(data.leftAt, nowMs)}
            {data.mailbox ? <><span className="text-text-faint">·</span>{data.mailbox}</> : null}
          </p>
        </div>
      </header>

      {/* Body */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {/* Audio */}
        <section className="space-y-2">
          <p className={sectionLabel}>Recording</p>
          {data.recordingUrl ? (
            <audio controls preload="none" src={data.recordingUrl} className="w-full">
              <track kind="captions" />
            </audio>
          ) : (
            <p className="text-caption text-text-faint">No recording available.</p>
          )}
          <p className="text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
            {formatDuration(data.durationSeconds)} long
          </p>
        </section>

        {/* Transcript */}
        {data.transcript ? (
          <section className="space-y-2">
            <p className={sectionLabel}>Transcript</p>
            <p className="whitespace-pre-line text-caption leading-6 text-text-muted">{data.transcript}</p>
          </section>
        ) : null}

        {/* Matched customer */}
        <section className="space-y-2">
          <p className={sectionLabel}>Customer</p>
          {data.matchedCustomerName ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-border-soft bg-surface-card px-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-text-soft">
                <User className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-caption font-bold text-text-default">{data.matchedCustomerName}</p>
                {number ? <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-text-soft">{formatPhoneNumber(number)}</p> : null}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-3 py-3">
              <p className="text-caption text-text-soft">No matched customer. Search by number when creating a ticket.</p>
            </div>
          )}
        </section>

        {/* Linked case */}
        <section className="space-y-2">
          <p className={sectionLabel}>Linked case</p>
          {data.linkedTicketId ? (
            <a
              href={`/support?ticket=${data.linkedTicketId}`}
              className="flex items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 transition-colors hover:bg-violet-100"
            >
              <span className="inline-flex items-center gap-1.5 text-caption font-bold text-violet-800">
                <Link2 className="h-3.5 w-3.5" /> Zendesk ticket #{data.linkedTicketId}
              </span>
              <ExternalLink className="h-3.5 w-3.5 text-violet-500" />
            </a>
          ) : (
            <p className="text-caption text-text-faint">Not linked to a ticket yet.</p>
          )}
        </section>

        {data.note ? (
          <section className="space-y-2">
            <p className={sectionLabel}>Note</p>
            <p className="text-caption leading-6 text-text-muted">{data.note}</p>
          </section>
        ) : null}
      </div>

      {/* Action row */}
      <footer className="shrink-0 border-t border-border-hairline px-5 py-3">
        {followup.isError && !isNotConfigured(followup.error) ? (
          <p className="mb-2 text-eyebrow font-semibold text-rose-600">Couldn’t update — try again.</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={<Phone className="h-4 w-4" />}
            loading={call.isPending}
            disabled={!number}
            onClick={() => number && call.mutate({ to: number, voicemailId })}
          >
            Call back
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Check className="h-4 w-4" />}
            loading={followup.isPending}
            disabled={isDone}
            onClick={() => followup.mutate({ status: 'done' })}
          >
            {isDone ? 'Done' : 'Mark done'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Clock className="h-4 w-4" />}
            disabled={followup.isPending}
            onClick={() => followup.mutate({ status: 'snoozed', snoozeUntil: snoozeTomorrow })}
          >
            Snooze 1d
          </Button>
          <a
            href={`/support?mode=tickets&compose=vm-${voicemailId}`}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-label font-semibold text-blue-600 transition-colors hover:bg-blue-50"
          >
            <Link2 className="h-4 w-4" /> Create ticket
          </a>
        </div>
      </footer>
    </div>
  );
}

function CenteredPane({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6">{children}</div>;
}
