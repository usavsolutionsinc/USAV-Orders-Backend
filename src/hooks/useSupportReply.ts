'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import type { ZendeskComment } from '@/lib/zendesk';
import { zendeskKeys, type CommentsResult } from './useZendeskQueries';

/**
 * Post a public reply / internal note to a ticket — with optional drag-dropped
 * file attachments and CC collaborator emails. Routes through
 * POST /api/zendesk/photo-ticket (mode=update), the same chokepoint the
 * photo→ticket modal uses, so chat replies and the modal share one attachment
 * pipeline.
 *
 * Optimistic: the new comment is inserted into the comments cache immediately so
 * it appears as a chat entry the instant you send, then reconciled against the
 * server on settle. Rolls back on error.
 */
export interface SupportReplyVars {
  ticketId: number;
  body: string;
  isPublic: boolean;
  files?: File[];
  /** Library photo ids (already uploaded to GCS) to attach to the comment. */
  photoIds?: number[];
  /** Preview urls for the staged photos, used only for the optimistic echo. */
  attachmentPreviews?: { url: string; thumbUrl?: string }[];
  /** CC collaborator emails (public replies only). */
  emailCcs?: string[];
  /** Formatted HTML for the customer email (rendered from the markdown body). */
  htmlBody?: string;
}

export function useSupportReply() {
  const qc = useQueryClient();
  return useMutation<
    { attached: number },
    Error,
    SupportReplyVars,
    { prev?: CommentsResult; tempId: number }
  >({
    mutationFn: async ({ ticketId, body, isPublic, files = [], photoIds, emailCcs, htmlBody }) => {
      const fd = new FormData();
      fd.append(
        'meta',
        JSON.stringify({
          mode: 'update',
          ticketId,
          comment: body,
          htmlBody,
          isPublic,
          emailCcs: isPublic ? emailCcs : undefined,
          photoIds: photoIds?.length ? photoIds : undefined,
        }),
      );
      files.forEach((f) => fd.append('files', f, f.name));
      const res = await fetch('/api/zendesk/photo-ticket', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string; message?: string; attached?: number }
        | null;
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || data?.message || `Failed to send (${res.status})`);
      }
      return { attached: data.attached ?? 0 };
    },
    onMutate: async ({ ticketId, body, isPublic, htmlBody, attachmentPreviews }) => {
      await qc.cancelQueries({ queryKey: zendeskKeys.comments(ticketId) });
      const prev = qc.getQueryData<CommentsResult>(zendeskKeys.comments(ticketId));
      const tempId = -Date.now();
      // `__ours` marks our optimistic echo for bubble styling until the server
      // row replaces it.
      const optimistic = {
        id: tempId,
        author_id: 0,
        body,
        html_body: htmlBody,
        public: isPublic,
        created_at: new Date().toISOString(),
        __ours: true,
        __optimistic: true,
        attachments: (attachmentPreviews ?? []).map((p, i) => ({
          id: tempId - i,
          file_name: 'photo',
          content_url: p.url,
          thumbnail_url: p.thumbUrl ?? p.url,
          content_type: 'image/*',
        })),
      } as unknown as ZendeskComment;
      if (prev) {
        qc.setQueryData<CommentsResult>(zendeskKeys.comments(ticketId), {
          ...prev,
          comments: [...prev.comments, optimistic],
          count: prev.count + 1,
        });
      }
      return { prev, tempId };
    },
    onError: (err, { ticketId }, ctx) => {
      if (ctx?.prev) qc.setQueryData(zendeskKeys.comments(ticketId), ctx.prev);
      toast.error(err.message || 'Could not send the message');
    },
    onSuccess: (_d, { isPublic }) => {
      toast.success(isPublic ? 'Reply sent' : 'Internal note added');
    },
    onSettled: (_d, _e, { ticketId }) => {
      void qc.invalidateQueries({ queryKey: zendeskKeys.comments(ticketId) });
      void qc.invalidateQueries({ queryKey: zendeskKeys.ticket(ticketId) });
      void qc.invalidateQueries({ queryKey: zendeskKeys.photos(ticketId) });
    },
  });
}
