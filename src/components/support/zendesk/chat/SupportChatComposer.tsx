'use client';

import { useMemo, useState } from 'react';
import { Globe, Lock, Mail, Paperclip, Send, X } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { usePhotoDropzone } from '@/hooks/usePhotoDropzone';
import { useSupportReply } from '@/hooks/useSupportReply';
import { useZendeskAgents } from '@/hooks/useZendeskQueries';
import { markdownToHtml } from '@/lib/support/markdown';
import { cn } from '@/utils/_cn';

interface Added {
  id: string;
  file: File;
  url: string;
}
let seq = 0;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Chat composer — public reply / internal note toggle, drag-drop (or click) photo
 * attach, ⌘↵ to send. Posts through {@link useSupportReply} (the shared
 * photo→ticket pipeline) so replies and the modal attach files identically.
 */
export function SupportChatComposer({
  ticketId,
  requesterEmail,
}: {
  ticketId: number;
  requesterEmail?: string | null;
}) {
  const [body, setBody] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [files, setFiles] = useState<Added[]>([]);
  const [ccs, setCcs] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState('');
  const reply = useSupportReply();
  const { data: agents = [] } = useZendeskAgents();

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

  const dz = usePhotoDropzone((incoming) =>
    setFiles((prev) => [
      ...prev,
      ...incoming.map((file) => ({ id: `f-${(seq += 1)}`, file, url: URL.createObjectURL(file) })),
    ]),
  );

  const removeFile = (id: string) =>
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((f) => f.id !== id);
    });

  const submit = () => {
    const text = body.trim();
    if (!text || reply.isPending) return;
    // Fold a half-typed CC into the list so it isn't silently dropped.
    const pendingCc = ccInput.trim();
    const allCcs = isPublic
      ? Array.from(new Set([...ccs, ...(pendingCc && EMAIL_RE.test(pendingCc) ? [pendingCc] : [])]))
      : [];
    reply.mutate(
      {
        ticketId,
        body: text,
        isPublic,
        files: files.map((f) => f.file),
        emailCcs: allCcs.length ? allCcs : undefined,
        htmlBody: markdownToHtml(text),
      },
      {
        onSuccess: () => {
          setBody('');
          files.forEach((f) => URL.revokeObjectURL(f.url));
          setFiles([]);
          setCcs([]);
          setCcInput('');
        },
      },
    );
  };

  return (
    <div
      {...dz.rootProps}
      className={cn(
        'shrink-0 border-t bg-white px-4 py-3 transition-colors',
        dz.isDragging ? 'border-blue-300 bg-blue-50/40' : 'border-gray-100',
      )}
    >
      <div className="mb-2.5 flex items-center justify-between">
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
          <button
            type="button"
            onClick={() => setIsPublic(true)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-bold transition',
              isPublic ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <Globe className="h-3.5 w-3.5" /> Public reply
          </button>
          <button
            type="button"
            onClick={() => setIsPublic(false)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-bold transition',
              !isPublic ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <Lock className="h-3.5 w-3.5" /> Internal note
          </button>
        </div>
        <button
          type="button"
          onClick={dz.openPicker}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
        >
          <Paperclip className="h-3.5 w-3.5" /> Attach
        </button>
        <input ref={dz.inputRef} {...dz.inputProps} />
      </div>

      {/* CC collaborators — public replies only (CCs make no sense on a note). */}
      {isPublic ? (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50/60 px-2 py-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
            <Mail className="h-3 w-3" /> Cc
          </span>
          {ccs.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200"
            >
              {email}
              <button
                type="button"
                onClick={() => removeCc(email)}
                aria-label={`Remove ${email}`}
                className="rounded-full text-blue-400 transition hover:text-blue-700"
              >
                <X className="h-2.5 w-2.5" />
              </button>
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
            className="min-w-[8rem] flex-1 bg-transparent px-1 text-[12px] text-gray-800 outline-none placeholder:text-gray-400"
          />
          <datalist id="support-cc-suggestions">
            {ccSuggestions.map((email) => (
              <option key={email} value={email} />
            ))}
          </datalist>
        </div>
      ) : null}

      {files.length ? (
        <div className="mb-2.5 flex flex-wrap gap-2">
          {files.map((f) => (
            <div key={f.id} className="relative h-14 w-14 overflow-hidden rounded-lg ring-1 ring-inset ring-gray-200">
              {/* blob preview of a just-dropped file */}
              <img src={f.url} alt={f.file.name} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeFile(f.id)}
                aria-label="Remove"
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-gray-900/70 text-white transition hover:bg-gray-900"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          'rounded-xl border bg-white transition',
          isPublic
            ? 'border-gray-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100'
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
          className="block w-full resize-none rounded-xl bg-transparent px-3.5 py-2.5 text-[13px] leading-relaxed text-gray-900 outline-none placeholder:text-gray-400"
        />
        <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
          <span className="text-[11px] text-gray-400">
            {dz.isDragging
              ? 'Drop to attach'
              : files.length
                ? `${files.length} attachment${files.length === 1 ? '' : 's'}`
                : 'Drag photos in · **bold** *italic* `code` supported'}
          </span>
          <Button
            variant={isPublic ? 'primary' : 'secondary'}
            size="sm"
            loading={reply.isPending}
            disabled={!body.trim()}
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
