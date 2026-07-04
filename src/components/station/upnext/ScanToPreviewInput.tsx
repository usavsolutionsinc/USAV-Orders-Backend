'use client';

import { useEffect, useRef, useState } from 'react';
import { Barcode } from '@/components/Icons';
import { dispatchUpNextPreview } from '@/utils/events';

/* ─────────────────────────────────────────────────────────────────────────
 *  ScanToPreviewInput
 *  ───────────────────────────────────────────────────────────────────────
 *  Floats at the bottom of the sidebar. Tech scans a tracking number (or
 *  types one and presses Enter); we search the current Up Next set for a
 *  matching order and fire `tech-upnext-preview`, which the workspace
 *  treats identically to clicking the sidebar card.
 *
 *  View-only — never starts or fulfills the order. That's the role of the
 *  top-of-page scan-to-fulfill bar.
 *
 *  Match rule: exact `trim()` on `shipping_tracking_number`, falling back
 *  to an exact match on `order_id`.
 *  ─────────────────────────────────────────────────────────────────── */

type ScanFeedback = 'idle' | 'matched' | 'missed';

export function ScanToPreviewInput({ orders }: { orders: any[] }) {
  const [value, setValue] = useState('');
  const [feedback, setFeedback] = useState<ScanFeedback>('idle');
  const feedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const flash = (next: ScanFeedback) => {
    setFeedback(next);
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setFeedback('idle'), 900);
  };

  const handleSubmit = () => {
    const needle = value.trim();
    if (!needle) return;
    const lower = needle.toLowerCase();
    const match = orders.find((o) => {
      const trk = String(o?.shipping_tracking_number || '').trim().toLowerCase();
      const oid = String(o?.order_id || '').trim().toLowerCase();
      return (trk && trk === lower) || (oid && oid === lower);
    });
    if (match) {
      dispatchUpNextPreview({ kind: 'order', order: match });
      setValue('');
      flash('matched');
    } else {
      flash('missed');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setValue('');
      setFeedback('idle');
    }
  };

  const wrapperTone =
    feedback === 'matched'
      ? 'border-emerald-300 bg-emerald-50/80 ring-1 ring-inset ring-emerald-200'
      : feedback === 'missed'
      ? 'border-red-300 bg-red-50/80 ring-1 ring-inset ring-red-200'
      : 'border-border-soft bg-surface-card focus-within:border-blue-300 focus-within:ring-1 focus-within:ring-inset focus-within:ring-blue-200';

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 shadow-[0_4px_12px_-4px_rgba(15,23,42,0.12)] transition-colors ${wrapperTone}`}
    >
      <Barcode
        className={`h-3.5 w-3.5 flex-shrink-0 ${
          feedback === 'matched' ? 'text-emerald-500' : feedback === 'missed' ? 'text-red-500' : 'text-text-faint'
        }`}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Scan tracking to preview…"
        aria-label="Scan tracking number to preview order"
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-label font-semibold text-text-default outline-none placeholder:font-medium placeholder:text-text-faint"
      />
      {feedback === 'missed' ? (
        <span className="text-micro font-black uppercase tracking-widest text-red-500">
          No match
        </span>
      ) : feedback === 'matched' ? (
        <span className="text-micro font-black uppercase tracking-widest text-emerald-600">
          Selected
        </span>
      ) : (
        <kbd className="hidden rounded bg-surface-sunken px-1 py-px text-eyebrow font-bold text-text-soft sm:inline-flex">
          ↵
        </kbd>
      )}
    </div>
  );
}
