'use client';

import { useId, useState } from 'react';
import { Mail, X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';

/** Loose email shape — good enough to gate a CC chip; Zendesk validates for real. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidCcEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

interface Props {
  /** Committed CC emails. */
  emails: string[];
  onChange: (emails: string[]) => void;
  /** Optional type-ahead pool (agent / requester emails). */
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
  /** Eyebrow shown before the chips (defaults to "Cc"). */
  label?: string;
}

/**
 * Chip-input for CC collaborator emails, mirroring the Support chat composer's
 * CC field. Commits on Enter / comma / semicolon / blur, de-dupes, and drops the
 * last chip on Backspace when the input is empty. Free entry (any valid email);
 * `suggestions` only power the datalist autocomplete.
 */
export function CcEmailField({
  emails,
  onChange,
  suggestions = [],
  placeholder,
  disabled,
  label = 'Cc',
}: Props) {
  const [input, setInput] = useState('');
  const listId = useId();

  const addCc = (raw: string) => {
    const email = raw.trim().replace(/[,;]+$/, '');
    if (!email || !EMAIL_RE.test(email) || emails.includes(email)) return;
    onChange([...emails, email]);
    setInput('');
  };
  const removeCc = (email: string) => onChange(emails.filter((e) => e !== email));

  const available = suggestions.filter((e) => e && !emails.includes(e));

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border-soft bg-surface-canvas/60 px-2 py-1.5">
      <span className="inline-flex items-center gap-1 text-micro font-black uppercase tracking-widest text-text-faint">
        <Mail className="h-3 w-3" /> {label}
      </span>
      {emails.map((email) => (
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
        list={listId}
        value={input}
        disabled={disabled}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
            e.preventDefault();
            addCc(input);
          } else if (e.key === 'Backspace' && !input && emails.length) {
            removeCc(emails[emails.length - 1]);
          }
        }}
        onBlur={() => addCc(input)}
        placeholder={emails.length ? 'Add another…' : (placeholder ?? 'Add email to CC…')}
        className="min-w-[8rem] flex-1 bg-transparent px-1 text-label text-text-default outline-none placeholder:text-text-faint disabled:opacity-50"
      />
      <datalist id={listId}>
        {available.map((email) => (
          <option key={email} value={email} />
        ))}
      </datalist>
    </div>
  );
}
