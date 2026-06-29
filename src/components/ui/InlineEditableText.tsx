'use client';

/**
 * InlineEditableText — Notion-style click-to-edit text. The display IS the
 * control: hover reveals a faint pencil, click swaps to an inline input, Enter /
 * blur commits, Escape reverts. No popover, no modal, no separate edit button —
 * the house "contextual CRUD" affordance.
 *
 * Pure presentation: the caller owns persistence via `onSave` (which may be async;
 * a spinner shows while it resolves). `stopPropagation` on click/keys so it can
 * live inside a clickable row without triggering the row's handler.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Pencil } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

export function InlineEditableText({
  value,
  onSave,
  placeholder = 'Empty',
  className = '',
  inputClassName,
  ariaLabel = 'Edit',
  disabled = false,
}: {
  value: string;
  onSave: (next: string) => Promise<void> | void;
  placeholder?: string;
  /** Applied to the display button (match the surrounding text style). */
  className?: string;
  /** Applied to the input; defaults to a compact inherit-styled field. */
  inputClassName?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the draft in sync when the upstream value changes (e.g. a refetch) —
  // but not while the user is mid-edit.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  if (disabled) {
    return <span className={className}>{value || placeholder}</span>;
  }

  const commit = async () => {
    const next = draft.trim();
    if (next === (value ?? '').trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (!editing) {
    return (
      <HoverTooltip label="Click to edit" asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          aria-label={ariaLabel}
          className={`ds-raw-button group/inline inline-flex max-w-full items-center gap-1 rounded text-left transition-colors hover:bg-blue-50/70 focus:outline-none focus:ring-2 focus:ring-blue-400/40 ${className}`}
        >
          <span className="truncate">
            {value || <span className="text-gray-400">{placeholder}</span>}
          </span>
          <Pencil className="h-3 w-3 shrink-0 text-gray-300 opacity-0 transition-opacity group-hover/inline:opacity-100" />
        </button>
      </HoverTooltip>
    );
  }

  return (
    <span
      className="inline-flex max-w-full items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(value);
            setEditing(false);
          }
        }}
        onBlur={() => void commit()}
        placeholder={placeholder}
        disabled={saving}
        className={
          inputClassName ??
          'min-w-0 flex-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-inherit font-normal normal-case tracking-normal text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60'
        }
      />
      {saving ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-gray-400" /> : null}
    </span>
  );
}
