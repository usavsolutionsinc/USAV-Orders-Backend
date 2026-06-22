import { useCallback, useState } from 'react';
import { useResourceMutation } from '@/hooks';
import { toast } from '@/lib/toast';
import { ExternalLink, Loader2, Sparkles } from '@/components/Icons';
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
        <button
          type="button"
          onClick={() => onPush()}
          disabled={pushing || drafting}
          className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pushing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
          {pushing ? 'Pushing…' : 'Push to Zendesk'}
        </button>
        <button
          type="button"
          onClick={() => void fetchDraft(true)}
          disabled={pushing || drafting}
          title="Generate a clearer ticket with local AI, then review and edit before pushing"
          className="inline-flex items-center gap-1.5 rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-purple-700 hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {drafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Draft with AI
        </button>
        <button
          type="button"
          onClick={() => void fetchDraft(false)}
          disabled={pushing || drafting}
          className="text-micro font-bold uppercase tracking-wider text-gray-500 hover:text-gray-900 disabled:opacity-60"
        >
          Review &amp; edit
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-eyebrow font-black uppercase tracking-widest text-gray-400">
          Subject
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="block w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-label font-semibold text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
      </div>
      <div>
        <label className="mb-1 block text-eyebrow font-black uppercase tracking-widest text-gray-400">
          Body
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={8}
          className="block w-full resize-y rounded-md border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-micro leading-snug text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onPush({ subject: subject.trim(), description: description.trim() })}
          disabled={pushing || drafting || !subject.trim() || !description.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-micro font-black uppercase tracking-wider text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pushing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
          {pushing ? 'Pushing…' : 'Push this ticket'}
        </button>
        <button
          type="button"
          onClick={() => void fetchDraft(true)}
          disabled={pushing || drafting}
          className="inline-flex items-center gap-1.5 rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-purple-700 hover:bg-purple-100 disabled:opacity-60"
        >
          {drafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Redraft
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pushing || drafting}
          className="text-micro font-bold uppercase tracking-wider text-gray-500 hover:text-gray-900 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
