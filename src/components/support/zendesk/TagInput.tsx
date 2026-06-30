'use client';

import { useState, type KeyboardEvent } from 'react';
import { Tag, X } from '@/components/Icons';

/**
 * Chip-style tag editor shared across the Zendesk support surfaces (claim
 * composer + ticket header). Tags are normalized to `lower_snake_case`; Enter or
 * comma adds, Backspace on an empty input removes the last tag.
 */
export function TagInput({
  tags,
  onChange,
  placeholder = 'Add tags…',
  disabled = false,
}: {
  tags: string[];
  onChange: (t: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim().replace(/\s+/g, '_').toLowerCase();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setDraft('');
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-1.5 transition focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-caption font-bold text-gray-700"
        >
          <Tag className="h-3 w-3 text-gray-400" />
          {t}
          <button
            type="button"
            onClick={() => onChange(tags.filter((x) => x !== t))}
            aria-label={`Remove ${t}`}
            className="ds-raw-button text-gray-400 hover:text-gray-700"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        placeholder={tags.length ? '' : placeholder}
        className="min-w-[80px] flex-1 bg-transparent text-label outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}
