'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, Mail, Paperclip, Send, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { VisibilityToggle } from '@/components/ui/VisibilityToggle';
import { usePhotoDropzone } from '@/hooks/usePhotoDropzone';
import { useSupportReply } from '@/hooks/useSupportReply';
import { useZendeskAgents, zendeskKeys } from '@/hooks/useZendeskQueries';
import type { TicketPhotoStaging } from '@/hooks/useTicketPhotoStaging';
import { useAuth } from '@/contexts/AuthContext';
import { markdownToHtml } from '@/lib/support/markdown';
import { cn } from '@/utils/_cn';
import { SupportPhotoLibraryPicker } from './SupportPhotoLibraryPicker';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Chat composer — public reply / internal note toggle, CC collaborators, photo
 * attach (via the ticket-level drop overlay or the Attach button), ⌘↵ to send.
 * Internal notes auto-sign with the current staffer's name for attribution.
 * Posts through {@link useSupportReply} (the shared photo→ticket pipeline).
 */
export function SupportChatComposer({
  ticketId,
  requesterEmail,
  staging,
}: {
  ticketId: number;
  requesterEmail?: string | null;
  staging: TicketPhotoStaging;
}) {
  const [body, setBody] = useState('');
  // Default to internal note — public replies are the deliberate exception.
  const [isPublic, setIsPublic] = useState(false);
  const [ccs, setCcs] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const queryClient = useQueryClient();
  const reply = useSupportReply();
  const { data: agents = [] } = useZendeskAgents();
  const { user, has, isLoaded } = useAuth();
  const canBrowseLibrary = isLoaded && has('photos.view');
  const staffName = user?.name?.trim() || '';

  // Reuse the dropzone hook purely for its file-picker plumbing (the ticket
  // panel owns the actual drag overlay, so we don't spread rootProps here).
  const picker = usePhotoDropzone(staging.addFiles);

  // Type-ahead pool: the ticket requester + every agent email, minus the ones
  // already added. Free entry is still allowed (any valid email).
  const ccSuggestions = useMemo(() => {
    const pool = [
      ...(requesterEmail ? [requesterEmail] : []),
      ...agents.map((a) => a.email).filter((e): e is string => Boolean(e)),
    ];
    return Array.from(new Set(pool)).filter((e) => !ccs.includes(e));
  }, [agents, requesterEmail, ccs]);

  const addCc = (raw: string) => {
    const email = raw.trim().replace(/[,;]+$/, '');
    if (!email) return;
    if (!EMAIL_RE.test(email) || ccs.includes(email)) return;
    setCcs((prev) => [...prev, email]);
    setCcInput('');
  };
  const removeCc = (email: string) => setCcs((prev) => prev.filter((e) => e !== email));

  /** Internal notes are signed with the staffer's name for exact attribution. */
  const signNote = (text: string) => {
    if (isPublic || !staffName) return text;
    const sig = `— ${staffName}`;
    return text.trimEnd().endsWith(sig) ? text : `${text}\n\n${sig}`;
  };

  const stagedDone = staging.staged.filter((s) => s.status === 'done' && typeof s.photoId === 'number');
  const stagedPhotoIds = useMemo(
    () => new Set(stagedDone.map((s) => s.photoId!)),
    [stagedDone],
  );

  const submit = () => {
    const text = body.trim();
    if (!text || reply.isPending || staging.uploading) return;
    const finalText = signNote(text);
    // Fold a half-typed CC into the list so it isn't silently dropped.
    const pendingCc = ccInput.trim();
    const allCcs = isPublic
      ? Array.from(new Set([...ccs, ...(pendingCc && EMAIL_RE.test(pendingCc) ? [pendingCc] : [])]))
      : [];
    reply.mutate(
      {
        ticketId,
        body: finalText,
        isPublic,
        photoIds: stagedDone.map((s) => s.photoId!),
        attachmentPreviews: stagedDone.map((s) => ({ url: s.url!, thumbUrl: s.thumbUrl })),
        emailCcs: allCcs.length ? allCcs : undefined,
        htmlBody: markdownToHtml(finalText),
      },
      {
        onSuccess: () => {
          setBody('');
          setCcs([]);
          setCcInput('');
          staging.clear();
        },
      },
    );
  };

  // Contextual QoL microcopy in the footer (the ⌘↵ + formatting hints live in
  // the textarea placeholder, so they're omitted here to avoid duplication).
  const hint = staging.uploading
    ? 'Uploading photo…'
    : staging.staged.length
      ? `${staging.staged.length} photo${staging.staged.length === 1 ? '' : 's'} ready to attach`
      : isPublic
        ? `Drag photos to attach${ccs.length ? ` · ${ccs.length} cc` : ''}`
        : `${staffName ? `Signs as — ${staffName} · ` : ''}Not emailed`;

  return (
    <div className="shrink-0 border-t border-border-hairline bg-surface-card px-4 py-3">
      <div className="mb-2.5 flex items-center justify-between">
        <VisibilityToggle
          value={isPublic}
          onChange={setIsPublic}
          internalLabel="Internal note"
          publicLabel="Public reply"
        />
        <div className="flex items-center gap-1">
          {canBrowseLibrary ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLibraryOpen(true)}
              icon={<ImageIcon className="h-3.5 w-3.5" />}
              className="gap-1.5 px-2 text-caption font-bold"
            >
              Library
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={picker.openPicker}
            icon={<Paperclip className="h-3.5 w-3.5" />}
            className="gap-1.5 px-2 text-caption font-bold"
          >
            Attach
          </Button>
        </div>
        <input ref={picker.inputRef} {...picker.inputProps} />
      </div>

      {canBrowseLibrary ? (
        <SupportPhotoLibraryPicker
          ticketId={ticketId}
          open={libraryOpen}
          onClose={() => setLibraryOpen(false)}
          excludePhotoIds={stagedPhotoIds}
          onSelect={(photos) => {
            staging.addLibraryPhotos(photos);
            void queryClient.invalidateQueries({ queryKey: zendeskKeys.photos(ticketId) });
          }}
        />
      ) : null}

      {/* CC collaborators — public replies only (CCs make no sense on a note). */}
      {isPublic ? (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-border-soft bg-surface-canvas/60 px-2 py-1.5">
          <span className="inline-flex items-center gap-1 text-micro font-black uppercase tracking-widest text-text-faint">
            <Mail className="h-3 w-3" /> Cc
          </span>
          {ccs.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-caption font-semibold text-blue-700 ring-1 ring-inset ring-blue-200"
            >
              {email}
              <IconButton
                onClick={() => removeCc(email)}
                ariaLabel={`Remove ${email}`}
                tone="accent"
                icon={<X className="h-2.5 w-2.5" />}
                className="rounded-full text-blue-400 hover:text-blue-700"
              />
            </span>
          ))}
          <input
            list="support-cc-suggestions"
            value={ccInput}
            onChange={(e) => setCcInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
                e.preventDefault();
                addCc(ccInput);
              } else if (e.key === 'Backspace' && !ccInput && ccs.length) {
                removeCc(ccs[ccs.length - 1]);
              }
            }}
            onBlur={() => addCc(ccInput)}
            placeholder={ccs.length ? 'Add another…' : 'Add email to CC…'}
            className="min-w-[8rem] flex-1 bg-transparent px-1 text-label text-text-default outline-none placeholder:text-text-faint"
          />
          <datalist id="support-cc-suggestions">
            {ccSuggestions.map((email) => (
              <option key={email} value={email} />
            ))}
          </datalist>
        </div>
      ) : null}

      {staging.staged.length ? (
        <div className="mb-2.5 flex flex-wrap gap-2">
          {staging.staged.map((s) => (
            <div
              key={s.tempId}
              className={cn(
                'relative h-14 w-14 overflow-hidden rounded-lg ring-1 ring-inset',
                s.status === 'error' ? 'ring-rose-300' : 'ring-border-soft',
              )}
            >
              <img src={s.thumbUrl || s.previewUrl} alt={s.name} className="h-full w-full object-cover" />
              {s.status === 'uploading' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-scrim/30">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                </div>
              ) : null}
              {s.status === 'error' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-rose-900/40 text-mini font-black uppercase text-white">
                  Failed
                </div>
              ) : null}
              <IconButton
                onClick={() => staging.remove(s.tempId)}
                ariaLabel="Remove"
                icon={<X className="h-2.5 w-2.5" />}
                // ds-allow-raw-neutral: glass overlay pinned on an image thumbnail — photo doesn't theme, stays dark
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-scrim/70 text-white hover:bg-gray-900"
              />
            </div>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          'rounded-xl border bg-surface-card transition',
          isPublic
            ? 'border-border-soft focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100'
            : 'border-amber-300 bg-amber-50/30 focus-within:ring-2 focus-within:ring-amber-100',
        )}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
          }}
          rows={3}
          placeholder={
            isPublic ? 'Reply to the customer…  (⌘↵ to send)' : 'Internal note — not emailed…  (⌘↵ to send)'
          }
          className="block w-full resize-none rounded-xl bg-transparent px-3.5 py-2.5 text-[13px] leading-relaxed text-text-default outline-none placeholder:text-text-faint"
        />
        <div className="flex items-center justify-between border-t border-border-hairline px-3 py-2">
          <span className="text-caption text-text-faint">{hint}</span>
          <Button
            variant={isPublic ? 'primary' : 'secondary'}
            size="sm"
            loading={reply.isPending}
            disabled={!body.trim() || staging.uploading}
            onClick={submit}
            icon={<Send className="h-3.5 w-3.5" />}
          >
            {isPublic ? 'Send reply' : 'Add note'}
          </Button>
        </div>
      </div>
    </div>
  );
}
