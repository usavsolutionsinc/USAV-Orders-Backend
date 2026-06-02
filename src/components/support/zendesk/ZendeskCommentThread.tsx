'use client';

import type { ZendeskAgent, ZendeskComment } from '@/lib/zendesk';
import { useTicketComments, useZendeskAgents } from '@/hooks/useZendeskQueries';
import { Spinner } from '@/design-system/primitives';
import { formatDateTimePST } from '@/utils/date';

export function ZendeskCommentThread({
  ticketId,
  requesterId,
}: {
  ticketId: number;
  requesterId?: number;
}) {
  const { data, isLoading, error } = useTicketComments(ticketId);
  const { data: agents = [] } = useZendeskAgents();
  const agentsById = new Map<number, ZendeskAgent>(agents.map((a) => [a.id, a] as [number, ZendeskAgent]));

  if (isLoading) {
    return (
      <div className="px-4 py-6">
        <Spinner />
      </div>
    );
  }
  if (error) {
    return <p className="px-4 py-4 text-caption text-rose-600">Couldn’t load the conversation.</p>;
  }

  const comments = data?.comments ?? [];
  if (!comments.length) {
    return <p className="px-4 py-4 text-caption text-gray-500">No messages yet.</p>;
  }

  const authorName = (c: ZendeskComment): string => {
    const a = agentsById.get(c.author_id);
    if (a) return a.name;
    if (requesterId && c.author_id === requesterId) return 'Requester';
    return `User #${c.author_id}`;
  };

  return (
    <div className="space-y-3 px-4 py-4">
      {comments.map((c) => {
        const a = agentsById.get(c.author_id);
        return (
          <div
            key={c.id}
            className={`rounded-xl border p-3 ${
              c.public ? 'border-gray-200 bg-white' : 'border-amber-200 bg-amber-50'
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {a?.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.photo} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
                ) : null}
                <span className="truncate text-caption font-bold text-gray-800">{authorName(c)}</span>
                {!c.public ? (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-micro font-black uppercase tracking-wider text-amber-700">
                    Internal
                  </span>
                ) : null}
              </div>
              <span className="shrink-0 text-micro text-gray-400">{formatDateTimePST(c.created_at)}</span>
            </div>
            <p className="whitespace-pre-wrap text-label leading-snug text-gray-800">{c.body}</p>
          </div>
        );
      })}
    </div>
  );
}
