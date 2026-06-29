'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Check, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { cn } from '@/utils/_cn';

// ─── Types ───────────────────────────────────────────────────────────────────

type IssueType = 'bug' | 'suggestion' | 'question';
type Phase = 'idle' | 'open' | 'submitting' | 'success' | 'error';

const TYPE_OPTS: { value: IssueType; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'question', label: 'Question' },
];

// ─── Form ────────────────────────────────────────────────────────────────────

interface FormProps {
  onSuccess: () => void;
}

export function FeedbackForm({ onSuccess }: FormProps) {
  const [type, setType] = useState<IssueType>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState<Phase>('open');
  const [errorMsg, setErrorMsg] = useState('');

  const submit = useCallback(async () => {
    if (!title.trim() || !description.trim()) return;
    setPhase('submitting');
    try {
      const res = await fetch('/api/user-issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          type,
          page: typeof window !== 'undefined' ? window.location.pathname : '',
        }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Unknown error');
      setPhase('success');
      setTimeout(() => onSuccess(), 1800);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
      setPhase('error');
    }
  }, [title, description, type, onSuccess]);

  if (phase === 'success') {
    return (
      <motion.div
        {...framerPresence.tableRow}
        transition={framerTransition.tableRowMount}
        className="flex flex-col items-center gap-3 py-8 text-center"
      >
        <Check className="h-10 w-10 text-emerald-500" />
        <p className="text-sm font-semibold text-gray-800">Got it — issue logged</p>
        <p className="text-xs text-gray-500">Claude Code will pick it up and open a PR</p>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="flex gap-1.5">
        {TYPE_OPTS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setType(opt.value)}
            className={cn(
              'ds-raw-button flex-1 rounded-lg border py-1.5 text-xs font-bold uppercase tracking-wider transition-colors duration-100',
              type === opt.value
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-micro font-black uppercase tracking-widest text-gray-400">
          Title <span className="text-rose-500">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Short description of the issue"
          maxLength={120}
          className={cn(
            'h-9 w-full rounded-lg border border-gray-200 bg-white px-3',
            'text-sm text-gray-900 placeholder:text-gray-400',
            'outline-none transition-colors duration-100',
            'focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100',
          )}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-micro font-black uppercase tracking-widest text-gray-400">
          Details <span className="text-rose-500">*</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What happened? What did you expect?"
          rows={4}
          className={cn(
            'w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2',
            'text-sm text-gray-900 placeholder:text-gray-400',
            'outline-none transition-colors duration-100',
            'focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100',
          )}
        />
      </div>

      {typeof window !== 'undefined' && (
        <p className="text-micro text-gray-400">
          Page: <span className="font-mono">{window.location.pathname}</span>
        </p>
      )}

      {phase === 'error' && (
        <p className="text-xs text-rose-600">{errorMsg}</p>
      )}

      <Button
        variant="primary"
        size="md"
        onClick={submit}
        disabled={!title.trim() || !description.trim() || phase === 'submitting'}
        loading={phase === 'submitting'}
        className="w-full justify-center"
      >
        Submit issue
      </Button>
    </div>
  );
}

// ─── Popover ─────────────────────────────────────────────────────────────────

interface FeedbackPopoverProps {
  onClose: () => void;
}

/**
 * Secondary popover surfaced from the Quick Access "Report an issue" action
 * row. Mirrors ActivityInboxPopover / PhoneHistoryPopover styling.
 */
export function FeedbackPopover({ onClose }: FeedbackPopoverProps) {
  return (
    <div
      role="dialog"
      aria-label="Report an issue"
      className="flex max-h-[calc(100vh-6rem)] w-[340px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
    >
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-gray-100 px-4 py-2">
        <div>
          <p className="text-sm font-black text-gray-900">Report an issue</p>
          <p className="text-caption text-gray-500">Bug, suggestion, or question</p>
        </div>
        <IconButton
          type="button"
          onClick={onClose}
          ariaLabel="Close"
          icon={<X className="h-3.5 w-3.5" />}
          className="text-gray-400 hover:text-gray-700"
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <FeedbackForm onSuccess={onClose} />
      </div>
    </div>
  );
}
