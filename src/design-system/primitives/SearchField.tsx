'use client';

import { type FormEvent, type ReactNode, type Ref, useEffect, useRef, useState } from 'react';
import { Clipboard, Loader2, Search, X } from '@/components/Icons';

export type SearchFieldTone =
  | 'blue'
  | 'orange'
  | 'red'
  | 'green'
  | 'emerald'
  | 'purple'
  | 'yellow'
  | 'neutral'
  | 'gray';

type SearchFieldSize = 'default' | 'compact';

const toneClassName: Record<SearchFieldTone, string> = {
  blue:    'border-blue-200 hover:border-blue-300 focus-within:border-blue-500 focus-within:hover:border-blue-500',
  orange:  'border-orange-200 hover:border-orange-300 focus-within:border-orange-500 focus-within:hover:border-orange-500',
  red:     'border-red-200 hover:border-red-300 focus-within:border-red-500 focus-within:hover:border-red-500',
  green:   'border-green-200 hover:border-green-300 focus-within:border-green-500 focus-within:hover:border-green-500',
  emerald: 'border-emerald-200 hover:border-emerald-300 focus-within:border-emerald-500 focus-within:hover:border-emerald-500',
  purple:  'border-purple-200 hover:border-purple-300 focus-within:border-purple-500 focus-within:hover:border-purple-500',
  yellow:  'border-amber-200 hover:border-amber-300 focus-within:border-amber-500 focus-within:hover:border-amber-500',
  neutral: 'border-border-default hover:border-border-emphasis focus-within:border-border-strong focus-within:hover:border-border-strong',
  gray:    'border-border-default hover:border-border-emphasis focus-within:border-border-strong focus-within:hover:border-border-strong',
};

const loaderToneClass: Record<SearchFieldTone, string> = {
  blue:    'text-blue-500',
  orange:  'text-orange-500',
  red:     'text-red-500',
  green:   'text-green-500',
  emerald: 'text-emerald-500',
  purple:  'text-purple-500',
  yellow:  'text-amber-500',
  neutral: 'text-text-soft',
  gray:    'text-text-muted',
};

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSearch?: (value: string) => void;
  onClear?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  className?: string;
  tone?: SearchFieldTone;
  size?: SearchFieldSize;
  isSearching?: boolean;
  rightElement?: ReactNode;
  leadingIcon?: ReactNode;
  autoFocus?: boolean;
  /** Debounce delay in ms before onChange fires. Default 320ms. */
  debounceMs?: number;
  /**
   * Omit the field’s own bottom border so a parent can draw a single full-width rule
   * (e.g. sidebar scan strips).
   */
  hideUnderline?: boolean;
  /** Hide the clear (X) control when the field has a value. */
  hideClear?: boolean;
  /**
   * Replaces the default trailing slot (spinner / pending / clear / paste).
   * Use with {@link rightElement} when paste/clear should sit outside the form (e.g. row remove X left of paste).
   */
  customTrailingSlot?: ReactNode;
  /**
   * Renders immediately before the default trailing control (inside the search field row).
   * Use for compact actions that should sit left of paste (e.g. “product not in catalog”).
   */
  trailingPrefix?: ReactNode;
  /**
   * Renders after the default trailing control in the same row (e.g. divider + assistant
   * action on the header search pill).
   */
  trailingSuffix?: ReactNode;
  /** When true, trailing slot shows only paste (clipboard); never the clear (X) button when the field has text. */
  pasteOnlyTrailing?: boolean;
}

/**
 * SearchField — decoupled draft architecture.
 *
 * The input owns its own `draft` state so parent re-renders during async fetches
 * never disrupt the cursor position or erase typed characters. The `onChange`
 * prop is called only after the debounce window, preventing per-keystroke DB pings.
 *
 * Sync contract:
 *  - Parent clears `value` → draft resets immediately.
 *  - Parent sets non-empty `value` → draft syncs only while input is not focused.
 *  - Draft → parent: debounced, so a single DB query fires after typing pauses.
 */
export function SearchField({
  value,
  onChange,
  onSearch,
  onClear,
  inputRef,
  placeholder = 'Search',
  className = '',
  tone = 'blue',
  size = 'compact',
  isSearching = false,
  rightElement,
  leadingIcon,
  autoFocus = false,
  debounceMs = 320,
  hideUnderline = false,
  hideClear = false,
  customTrailingSlot,
  trailingPrefix,
  trailingSuffix,
  pasteOnlyTrailing = false,
}: SearchFieldProps) {
  // Internal draft — avoid churn from async parent updates during typing.
  const [draft, setDraft] = useState(value);
  const committedRef = useRef(value);   // last value we sent to onChange
  const isMountedRef = useRef(false);
  const debounceTimeoutRef = useRef<number | null>(null);
  const inputElementRef = useRef<HTMLInputElement | null>(null);

  const setInputRef = (node: HTMLInputElement | null) => {
    inputElementRef.current = node;
    if (!inputRef) return;
    if (typeof inputRef === 'function') {
      inputRef(node);
      return;
    }
    (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
  };

  // Sync contract:
  // - Always sync clears (parent requested reset).
  // - Sync non-empty external updates only when input is not focused.
  //   This preserves typing focus/cursor during async search, while still
  //   allowing external actions (e.g. selecting a recent search) to update text.
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      setDraft(value);
      committedRef.current = value;
      return;
    }
    if (value === '' && committedRef.current !== '') {
      setDraft('');
      committedRef.current = '';
      return;
    }
    const isFocused = document.activeElement === inputElementRef.current;
    if (!isFocused && value !== draft) {
      setDraft(value);
      committedRef.current = value;
    }
  }, [draft, value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced propagation: fires onChange only after typing pauses.
  useEffect(() => {
    if (draft === committedRef.current) return;
    const id = window.setTimeout(() => {
      committedRef.current = draft;
      debounceTimeoutRef.current = null;
      onChange(draft);
    }, debounceMs);
    debounceTimeoutRef.current = id;
    return () => {
      window.clearTimeout(id);
      if (debounceTimeoutRef.current === id) debounceTimeoutRef.current = null;
    };
  }, [draft, debounceMs, onChange]);

  // Pending = user has typed but debounce hasn't fired yet — show a subtle dot.
  const isPending = draft !== committedRef.current && !isSearching;
  const hasValue = Boolean(draft.trim());

  const sizeClasses = size === 'compact'
    ? {
        field: hideUnderline ? '' : 'border-b pb-1',
        input: 'h-8 text-sm',
        rightSlot: 'h-8',
      }
    : {
        field: hideUnderline ? '' : 'border-b-2',
        input: 'h-8 text-sm',
        rightSlot: 'h-8',
      };

  const fieldGapClass = size === 'compact' ? 'gap-1' : 'gap-2';

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Flush debounce immediately on Enter.
    if (debounceTimeoutRef.current != null) {
      window.clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }
    committedRef.current = draft;
    onChange(draft);
    onSearch?.(draft);
  };

  const handleClear = () => {
    setDraft('');
    committedRef.current = '';
    onChange('');
    onClear?.();
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (trimmed) setDraft(trimmed);
    } catch {
      // clipboard blocked
    }
  };

  const icon = leadingIcon || <Search className="h-4 w-4" />;

  const trailingControl =
    customTrailingSlot !== undefined ? (
      customTrailingSlot
    ) : isSearching ? (
      <Loader2 className={`h-4 w-4 animate-spin ${loaderToneClass[tone]}`} />
    ) : isPending ? (
      <span className="flex h-4 w-4 items-center justify-center">
        <span
          className={`block h-[5px] w-[5px] rounded-full animate-pulse ${loaderToneClass[tone]} bg-current opacity-60`}
        />
      </span>
    ) : pasteOnlyTrailing ? (
      <button
        type="button"
        onClick={handlePaste}
        className="inline-flex h-4 w-4 items-center justify-center text-text-faint transition-colors duration-100 ease-out hover:text-blue-600 active:scale-95"
        aria-label="Paste from clipboard"
        title="Paste"
      >
        <Clipboard className="h-4 w-4" />
      </button>
    ) : hasValue ? (
      hideClear ? (
        <span className="h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <button
          type="button"
          onClick={handleClear}
          className="inline-flex h-4 w-4 items-center justify-center text-text-faint transition-colors duration-100 ease-out hover:text-text-default active:scale-95"
          aria-label="Clear search"
          title="Clear"
        >
          <X className="h-4 w-4" />
        </button>
      )
    ) : (
      <button
        type="button"
        onClick={handlePaste}
        className="inline-flex h-4 w-4 items-center justify-center text-text-faint transition-colors duration-100 ease-out hover:text-blue-600 active:scale-95"
        aria-label="Paste from clipboard"
        title="Paste"
      >
        <Clipboard className="h-4 w-4" />
      </button>
    );

  return (
    <div className={`flex w-full min-w-0 items-center ${fieldGapClass} ${className}`.trim()}>
      <form
        onSubmit={handleSubmit}
        className={`group flex min-w-0 flex-1 items-center ${fieldGapClass} transition-colors duration-150 ease-out ${sizeClasses.field} ${
          hideUnderline ? 'border-transparent' : toneClassName[tone]
        }`.trim()}
      >
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-text-faint transition-colors duration-100 ease-out group-focus-within:text-text-default">
          {icon}
        </span>

        <input
          ref={setInputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={`w-full border-0 bg-transparent px-0 font-bold text-text-default outline-none placeholder:font-medium placeholder:text-text-faint ${sizeClasses.input}`.trim()}
        />

        {/* Trailing row: prefix → spinner/pending/clear/paste → suffix */}
        <span
          className={`flex shrink-0 items-center gap-1.5 ${sizeClasses.rightSlot}`.trim()}
        >
          {trailingPrefix}
          {trailingControl}
          {trailingSuffix}
        </span>
      </form>

      {rightElement ? (
        <div className={`flex shrink-0 items-center ${sizeClasses.rightSlot}`}>{rightElement}</div>
      ) : null}
    </div>
  );
}
