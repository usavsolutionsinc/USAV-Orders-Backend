import { Lock, Mail, Send } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { PaneHeaderTabs } from '@/components/ui/pane-header';
import { cn } from '@/utils/_cn';
import type { FiledTicket } from '../claim-types';
import type { UseClaimTicketReply } from '../hooks/useClaimTicketReply';

interface Props {
  reply: UseClaimTicketReply;
  filedTicket: FiledTicket | null;
  /** Optional one-tap prefill (e.g. the drafted seller message). */
  prefill?: string;
}

type ReplyMode = 'internal' | 'public';

/**
 * Reply on the Zendesk ticket — internal note by default, or a public reply that
 * emails the customer.
 */
export function ClaimTicketReply({ reply, filedTicket, prefill }: Props) {
  const { body, setBody, isPublic, setIsPublic, sending, send } = reply;

  if (!filedTicket?.id) return null;

  const mode: ReplyMode = isPublic ? 'public' : 'internal';

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-micro font-black uppercase tracking-widest text-text-soft">
          Reply on {filedTicket.number}
        </p>
        <PaneHeaderTabs<ReplyMode>
          tabs={[
            {
              value: 'internal',
              label: (
                <span className="inline-flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Internal
                </span>
              ),
            },
            {
              value: 'public',
              label: (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3 w-3" /> Public
                </span>
              ),
            },
          ]}
          value={mode}
          onChange={(next) => setIsPublic(next === 'public')}
          className="rounded-lg border border-border-soft px-1 py-0.5"
        />
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder={
          isPublic
            ? 'Message the customer will receive by email…'
            : 'Internal note — not emailed to anyone…'
        }
        className={cn(
          'block w-full resize-y rounded-lg border bg-surface-card px-3 py-2 text-caption font-medium leading-snug text-text-default outline-none focus:ring-2',
          isPublic
            ? 'border-emerald-200 focus:border-emerald-400 focus:ring-emerald-500/20'
            : 'border-border-default focus:border-border-emphasis focus:ring-text-soft/20',
        )}
      />

      <div className="flex items-center justify-between gap-3">
        <p className={cn('text-mini font-semibold', isPublic ? 'text-emerald-700' : 'text-text-faint')}>
          {isPublic ? 'Emails the customer.' : 'Private note — no email sent.'}
        </p>
        <div className="flex items-center gap-2">
          {prefill?.trim() ? (
            <Button variant="ghost" size="sm" onClick={() => setBody(prefill)} disabled={sending}>
              Use seller msg
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            icon={<Send />}
            loading={sending}
            onClick={() => void send()}
            disabled={!body.trim()}
          >
            {isPublic ? 'Send to customer' : 'Add note'}
          </Button>
        </div>
      </div>
    </section>
  );
}
