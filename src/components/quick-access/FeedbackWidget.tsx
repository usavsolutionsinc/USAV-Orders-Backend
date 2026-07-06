'use client';

import { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Check } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { cn } from '@/utils/_cn';
import { QuickAccessPanelShell } from './QuickAccessPanelShell';

type IssueType = 'bug' | 'suggestion' | 'question';
type Phase = 'open' | 'submitting' | 'success' | 'error';

const TYPE_OPTS: { value: IssueType; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'question', label: 'Question' },
];

const FIELD_CLS =
  'w-full rounded-lg border border-border-soft bg-surface-card px-3 text-sm text-text-default ' +
  'placeholder:text-text-faint outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';

interface FeedbackFormProps {
  onSuccess: () => void;
  pagePath: string;
}

/** Standalone form export for embedding outside the popover shell. */
export function FeedbackForm({ onSuccess, pagePath }: FeedbackFormProps) {
  return <FeedbackPopoverBody onSuccess={onSuccess} pagePath={pagePath} embedded />;
}

interface FeedbackPopoverProps {
  onClose: () => void;
}

export function FeedbackPopover({ onClose }: FeedbackPopoverProps) {
  const pathname = usePathname() ?? '';
  return <FeedbackPopoverBody onSuccess={onClose} onClose={onClose} pagePath={pathname} />;
}

function FeedbackPopoverBody({
  onSuccess,
  onClose,
  pagePath,
  embedded = false,
}: FeedbackFormProps & { onClose?: () => void; embedded?: boolean }) {
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
        body: JSON.stringify({ title, description, type, page: pagePath }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Unknown error');
      setPhase('success');
      setTimeout(() => onSuccess(), 1600);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
      setPhase('error');
    }
  }, [title, description, type, pagePath, onSuccess]);

  const canSubmit = !!title.trim() && !!description.trim();

  const body =
    phase === 'success' ? (
      <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
        <Check className="h-8 w-8 text-emerald-600" />
        <p className="text-sm font-semibold text-text-default">Issue logged</p>
        <p className="text-caption text-text-soft">The team will pick it up from here.</p>
      </div>
    ) : (
      <div className="space-y-4 px-2 pb-2">
        <div className="flex gap-1 rounded-lg border border-border-hairline bg-surface-canvas p-0.5">
          {TYPE_OPTS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setType(opt.value)}
              className={cn(
                'ds-raw-button flex-1 rounded-md px-2 py-1.5 text-caption font-semibold transition-colors',
                type === opt.value
                  ? 'bg-surface-card text-text-default shadow-sm ring-1 ring-border-soft'
                  : 'text-text-soft hover:text-text-muted',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="space-y-1">
          <label htmlFor="issue-title" className="text-eyebrow font-black uppercase tracking-widest text-text-faint">
            Title
          </label>
          <input
            id="issue-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short description"
            maxLength={120}
            className={cn(FIELD_CLS, 'h-9')}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="issue-details" className="text-eyebrow font-black uppercase tracking-widest text-text-faint">
            Details
          </label>
          <textarea
            id="issue-details"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happened? What did you expect?"
            rows={4}
            className={cn(FIELD_CLS, 'resize-none py-2')}
          />
        </div>

        {pagePath ? (
          <p className="text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
            From {pagePath}
          </p>
        ) : null}

        {phase === 'error' ? (
          <p className="text-caption text-rose-600">{errorMsg}</p>
        ) : null}
      </div>
    );

  const footer =
    phase === 'success' ? undefined : (
      <Button
        variant="primary"
        size="md"
        onClick={submit}
        disabled={!canSubmit || phase === 'submitting'}
        loading={phase === 'submitting'}
        className="w-full justify-center"
      >
        Submit issue
      </Button>
    );

  if (embedded) {
    return (
      <div className="flex flex-col">
        {body}
        {footer ? <div className="border-t border-border-hairline px-4 py-3">{footer}</div> : null}
      </div>
    );
  }

  return (
    <QuickAccessPanelShell title="Report an issue" onClose={onClose ?? onSuccess} footer={footer}>
      {body}
    </QuickAccessPanelShell>
  );
}
