'use client';

import { TextField } from '@/design-system/primitives';

/**
 * Standalone per-line Notes card. Saves on blur (same contract SerialCard
 * used) — the parent decides whether the value actually changed.
 */
export function LineNotesCard({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
      <TextField
        multiline
        rows={2}
        label="Notes"
        value={value}
        onChange={onChange}
        onBlur={onBlur}
      />
    </section>
  );
}
