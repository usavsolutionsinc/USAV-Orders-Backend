import { useCallback, useState } from 'react';
import { useResourceMutation } from '@/hooks';
import { toast } from '@/lib/toast';
import { ExternalLink, Sparkles } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import type { UnfoundQueueDetailsRow } from '../unfound-triage-types';

/**
 * Push-to-Zendesk control with an optional AI draft + review step (A2).
 * Fast path: one-click "Push to Zendesk" uses the server's humanized template.
 * Review path: "Draft with AI" (or "Review & edit") opens an editable preview;
 * pushing then sends the edited subject/body as overrides. Operator keeps the pen.
 */
export function ZendeskPushSection({
  row,
  pushing,
  onPush,
}: {
  row: UnfoundQueueDetailsRow;
  pushing: boolean;
  onPush: (overrides?: { subject: string; description: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  const draftMut = useResourceMutation<
    { subject?: string; description?: string; degraded?: boolean },
    boolean
  >(async (ai) => {
    const res = await fetch(
      `/api/receiving/unfound-queue/${row.kind}/${encodeURIComponent(row.source_id)}/push-to-zendesk/draft`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai }),
      },
    );
    const data = (await res.json().catch(() => null)) as {
      success?: boolean;
      subject?: string;
      description?: string;
      degraded?: boolean;
      error?: string;
    } | null;
    if (!res.ok || !data?.success) throw new Error(data?.error || 'Could not generate ticket');
    return data;
  });
  const drafting = draftMut.isPending;

  const fetchDraft = useCallback(
    async (ai: boolean) => {
      try {
        const data = await draftMut.mutateAsync(ai);
        setSubject(data.subject ?? '');
        setDescription(data.description ?? '');
        setOpen(true);
        if (ai && data.degraded) {
          toast.warning('AI draft dropped a reference — kept the template. Edit as needed.');
        } else if (ai) {
          toast.success('Drafted with AI — review and edit before pushing');
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Network error');
      }
    },
    [draftMut],
  );

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={<ExternalLink className="h-3 w-3" />}
          loading={pushing}
          disabled={pushing || drafting}
          onClick={() => onPush()}
          className="border border-blue-200 bg-blue-50 text-blue-700 ring-0 hover:bg-blue-100"
        >
          {pushing ? 'Pushing…' : 'Push to Zendesk'}
        </Button>
        <HoverTooltip label="Generate a clearer ticket with local AI, then review and edit before pushing" asChild>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<Sparkles className="h-3 w-3" />}
            loading={drafting}
            disabled={pushing || drafting}
            onClick={() => void fetchDraft(true)}
            className="border border-purple-200 bg-purple-50 text-purple-700 ring-0 hover:bg-purple-100"
          >
            Draft with AI
          </Button>
        </HoverTooltip>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pushing || drafting}
          onClick={() => void fetchDraft(false)}
        >
          Review &amp; edit
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-eyebrow font-black uppercase tracking-widest text-text-faint">
          Subject
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="block w-full rounded-md border border-border-soft bg-surface-card px-2.5 py-1.5 text-label font-semibold text-text-default outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
      </div>
      <div>
        <label className="mb-1 block text-eyebrow font-black uppercase tracking-widest text-text-faint">
          Body
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={8}
          className="block w-full resize-y rounded-md border border-border-soft bg-surface-card px-2.5 py-1.5 font-mono text-micro leading-snug text-text-default outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          icon={<ExternalLink className="h-3 w-3" />}
          loading={pushing}
          disabled={pushing || drafting || !subject.trim() || !description.trim()}
          onClick={() => onPush({ subject: subject.trim(), description: description.trim() })}
        >
          {pushing ? 'Pushing…' : 'Push this ticket'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={<Sparkles className="h-3 w-3" />}
          loading={drafting}
          disabled={pushing || drafting}
          onClick={() => void fetchDraft(true)}
          className="border border-purple-200 bg-purple-50 text-purple-700 ring-0 hover:bg-purple-100"
        >
          Redraft
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pushing || drafting}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
