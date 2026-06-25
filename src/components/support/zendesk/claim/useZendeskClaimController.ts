'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import type {
  ClaimMode,
  ClaimPriority,
  ClaimResult,
  PickedTicket,
  ZendeskClaimModalProps,
} from './claim-types';

export type ZendeskClaimController = ReturnType<typeof useZendeskClaimController>;

interface AddedFile {
  id: string;
  file: File;
  url: string;
}

let addedSeq = 0;

/**
 * All state + the submit pipeline for {@link ZendeskClaimModal}. Thin shell +
 * presentational sections read from this (the God-component split pattern).
 */
export function useZendeskClaimController(props: ZendeskClaimModalProps) {
  const { open, onClose, photos, defaultMode, defaultTicketId, defaultTicketSubject, onDone } = props;

  const [mode, setMode] = useState<ClaimMode>(defaultMode ?? 'create');

  // ── Create fields ──────────────────────────────────────────────────────────
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<ClaimPriority>('normal');
  const [tags, setTags] = useState<string[]>([]);
  const [requesterName, setRequesterName] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');
  // First comment is internal by default so filing a ticket never emails anyone.
  const [createPublic, setCreatePublic] = useState(false);

  // ── Update fields ──────────────────────────────────────────────────────────
  const [ticket, setTicket] = useState<PickedTicket | null>(null);
  const [comment, setComment] = useState('');
  const [replyPublic, setReplyPublic] = useState(false);

  // ── Attachments: library photos (toggleable) + ad-hoc dropped files ──────────
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [added, setAdded] = useState<AddedFile[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaimResult | null>(null);

  // Seed once on open; reset once on close. A ref guard keeps `photos` changes
  // from re-seeding mid-edit and stops the close-reset from looping.
  const booted = useRef(false);
  useEffect(() => {
    if (open && !booted.current) {
      booted.current = true;
      setMode(defaultMode ?? (defaultTicketId ? 'update' : 'create'));
      setTicket(
        defaultTicketId
          ? { id: defaultTicketId, subject: defaultTicketSubject ?? null, status: 'open', priority: null }
          : null,
      );
      const refs = Array.from(
        new Set(photos.map((p) => p.poRef?.trim()).filter((v): v is string => Boolean(v))),
      );
      const poPart = refs.length === 1 ? ` — PO ${refs[0]}` : '';
      setSubject(`Photo evidence${poPart}`);
      setDescription(
        `Attaching ${photos.length} photo${photos.length === 1 ? '' : 's'} from the library` +
          (refs.length ? ` for ${refs.map((r) => `PO ${r}`).join(', ')}` : '') +
          '.',
      );
    }
    if (!open && booted.current) {
      booted.current = false;
      setMode(defaultMode ?? 'create');
      setSubject('');
      setDescription('');
      setPriority('normal');
      setTags([]);
      setRequesterName('');
      setRequesterEmail('');
      setCreatePublic(false);
      setTicket(null);
      setComment('');
      setReplyPublic(false);
      setExcluded(new Set());
      setAdded((prev) => {
        prev.forEach((a) => URL.revokeObjectURL(a.url));
        return [];
      });
      setSubmitting(false);
      setError(null);
      setResult(null);
    }
  }, [open, defaultMode, defaultTicketId, defaultTicketSubject, photos]);

  const includedPhotoIds = useMemo(
    () => photos.filter((p) => !excluded.has(p.id)).map((p) => p.id),
    [photos, excluded],
  );

  const togglePhoto = useCallback((id: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const addFiles = useCallback((files: File[]) => {
    setAdded((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: `added-${(addedSeq += 1)}`,
        file,
        url: URL.createObjectURL(file),
      })),
    ]);
  }, []);

  const removeAdded = useCallback((id: string) => {
    setAdded((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const totalAttach = includedPhotoIds.length + added.length;

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (mode === 'create') return subject.trim().length > 0 && description.trim().length > 0;
    return Boolean(ticket) && comment.trim().length > 0;
  }, [submitting, mode, subject, description, ticket, comment]);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const meta =
        mode === 'create'
          ? {
              mode: 'create' as const,
              subject: subject.trim(),
              description: description.trim(),
              isPublic: createPublic,
              priority,
              tags: tags.length ? tags : undefined,
              requester:
                requesterName || requesterEmail
                  ? { name: requesterName || undefined, email: requesterEmail || undefined }
                  : undefined,
              photoIds: includedPhotoIds,
            }
          : {
              mode: 'update' as const,
              ticketId: ticket!.id,
              comment: comment.trim(),
              isPublic: replyPublic,
              photoIds: includedPhotoIds,
            };

      const fd = new FormData();
      fd.append('meta', JSON.stringify(meta));
      added.forEach((a) => fd.append('files', a.file, a.file.name));

      const res = await fetch('/api/zendesk/photo-ticket', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string; message?: string; ticket?: { id: number; number: string; url: string | null }; attached?: number }
        | null;
      if (!res.ok || !data?.success || !data.ticket) {
        throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
      }
      const r: ClaimResult = {
        ticketId: data.ticket.id,
        number: data.ticket.number,
        url: data.ticket.url ?? null,
        mode,
        attached: data.attached ?? 0,
      };
      setResult(r);
      onDone?.(r);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    mode,
    subject,
    description,
    createPublic,
    priority,
    tags,
    requesterName,
    requesterEmail,
    includedPhotoIds,
    ticket,
    comment,
    replyPublic,
    added,
    onDone,
  ]);

  return {
    open,
    onClose,
    photos,
    mode,
    setMode,
    // create
    subject,
    setSubject,
    description,
    setDescription,
    priority,
    setPriority,
    tags,
    setTags,
    requesterName,
    setRequesterName,
    requesterEmail,
    setRequesterEmail,
    createPublic,
    setCreatePublic,
    // update
    ticket,
    setTicket,
    comment,
    setComment,
    replyPublic,
    setReplyPublic,
    // attachments
    excluded,
    togglePhoto,
    includedPhotoIds,
    added,
    addFiles,
    removeAdded,
    totalAttach,
    // status
    submitting,
    error,
    result,
    canSubmit,
    submit,
  };
}
