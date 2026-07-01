'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { ZendeskAgent, ZendeskComment, ZendeskUser } from '@/lib/zendesk';
import { useTicketComments, useZendeskAgents, useZendeskUsers } from '@/hooks/useZendeskQueries';
import { Spinner } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Globe, Lock } from '@/components/Icons';
import { formatDateTimePST } from '@/utils/date';
import { timeAgo } from '@/utils/_date';
import { cn } from '@/utils/_cn';
import { renderInlineMarkdown } from '@/lib/support/markdown';
import { initials, resolveAuthor } from './support-chat-utils';

interface ZAttachment {
  id: number;
  file_name: string;
  content_url: string;
  thumbnail_url?: string | null;
  content_type?: string | null;
}

function imageAttachments(c: ZendeskComment): ZAttachment[] {
  const raw = (c as { attachments?: unknown }).attachments;
  if (!Array.isArray(raw)) return [];
  return (raw as ZAttachment[]).filter(
    (a) => (a.content_type ?? '').startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(a.file_name ?? ''),
  );
}

function Time({ iso }: { iso: string }) {
  return (
    <HoverTooltip label={formatDateTimePST(iso)} focusable={false}>
      <span>{timeAgo(iso)}</span>
    </HoverTooltip>
  );
}

function Avatar({ name, photo, ours }: { name: string; photo: string | null; ours: boolean }) {
  if (photo) {
    return <img src={photo} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-micro font-black',
        ours ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600',
      )}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Bigger, in-app photo grid. Clicking a photo opens the shared PhotoViewerModal
 * (owned by SupportTicketDetail) via `onOpenPhoto` — never a new browser tab.
 */
function Attachments({
  atts,
  onDark,
  onOpenPhoto,
}: {
  atts: ZAttachment[];
  onDark: boolean;
  onOpenPhoto?: (url: string) => void;
}) {
  if (!atts.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {atts.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onOpenPhoto?.(a.content_url)}
          className={cn(
            'ds-raw-button block h-28 w-28 overflow-hidden rounded-xl ring-1 ring-inset transition hover:opacity-90 hover:ring-2',
            onDark ? 'ring-white/30 hover:ring-white/60' : 'ring-gray-200 hover:ring-blue-300',
          )}
        >
          <img
            src={a.thumbnail_url || a.content_url}
            alt={a.file_name}
            className="h-full w-full object-cover"
          />
        </button>
      ))}
    </div>
  );
}

/**
 * Chat-style timeline. Avatars always sit on the left; OUR messages (agent
 * public replies AND internal notes) use blue / amber bubbles, the requester
 * uses white. Bodies render inline markdown; authors resolve to a name/email
 * (never "User #<id>").
 */
export function SupportChatThread({
  ticketId,
  requesterId,
  requesterName,
  requesterEmail,
  onOpenPhoto,
}: {
  ticketId: number;
  requesterId?: number;
  requesterName?: string | null;
  requesterEmail?: string | null;
  onOpenPhoto?: (url: string) => void;
}) {
  const { data, isLoading, error } = useTicketComments(ticketId);
  const { data: agents = [] } = useZendeskAgents();
  const agentsById = useMemo(
    () => new Map<number, ZendeskAgent>(agents.map((a) => [a.id, a] as [number, ZendeskAgent])),
    [agents],
  );

  const comments = data?.comments ?? [];

  // Resolve non-agent authors (requester / end users) to a real name + email.
  const userIds = useMemo(
    () => comments.map((c) => c.author_id).filter((id) => id > 0 && !agentsById.has(id)),
    [comments, agentsById],
  );
  const { data: users = [] } = useZendeskUsers(userIds);
  const usersById = useMemo(
    () => new Map<number, ZendeskUser>(users.map((u) => [u.id, u] as [number, ZendeskUser])),
    [users],
  );

  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [comments.length]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (error) {
    return <p className="px-5 py-6 text-center text-sm text-rose-600">Couldn’t load the conversation.</p>;
  }
  if (!comments.length) {
    return (
      <div className="px-5 py-16 text-center">
        <p className="text-sm text-gray-400">No messages yet — start the conversation below.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-5 py-6">
      {comments.map((c) => {
        const a = resolveAuthor(c, { agentsById, usersById, requesterId, requesterName, requesterEmail });
        const atts = imageAttachments(c);
        const internal = c.public === false;
        const onDark = a.isOurs && !internal; // only the blue public bubble is dark

        return (
          <div key={c.id} className="flex items-end gap-2.5">
            <Avatar name={a.name} photo={a.photo} ours={a.isOurs} />
            <div className="min-w-0 max-w-[78%] items-start">
              <div className="mb-1 flex items-center gap-2 text-caption justify-start">
                {internal ? (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-amber-700">
                    <Lock className="h-2.5 w-2.5" /> Internal
                  </span>
                ) : a.isOurs ? (
                  <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-blue-700">
                    <Globe className="h-2.5 w-2.5" /> Public
                  </span>
                ) : null}
                <span className="font-bold text-gray-600">{a.name}</span>
                {a.email && a.email !== a.name ? (
                  <span className="truncate text-gray-400">· {a.email}</span>
                ) : null}
                <span className="text-gray-400">
                  · <Time iso={c.created_at} />
                </span>
              </div>
              <div
                className={cn(
                  'rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm',
                  a.isOurs
                    ? internal
                      ? 'rounded-bl-md border border-amber-200 bg-amber-50 text-amber-900'
                      : 'rounded-bl-md bg-blue-600 text-white'
                    : 'rounded-bl-md border border-gray-200 bg-white text-gray-800',
                )}
              >
                <div className="whitespace-pre-wrap break-words">{renderInlineMarkdown(c.body)}</div>
                <Attachments atts={atts} onDark={onDark} onOpenPhoto={onOpenPhoto} />
              </div>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
