import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Empty } from './incoming-details-primitives';

export function NotesTab({
  receivingId,
  initialValue,
}: {
  receivingId: number | null;
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Resync local draft when the panel reopens against a different PO whose
  // receiving row carries different support_notes.
  useEffect(() => setValue(initialValue), [initialValue, receivingId]);

  const save = useCallback(async () => {
    if (receivingId == null) {
      toast.error('No receiving row to attach notes to');
      return;
    }
    const trimmed = value.trim();
    if (trimmed === (initialValue || '').trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/receiving/${receivingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ support_notes: trimmed || null }),
      });
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'save failed');
      toast.success('Notes saved');
      queryClient.invalidateQueries({ queryKey: ['incoming-details'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Notes save failed');
    } finally {
      setSaving(false);
    }
  }, [receivingId, value, initialValue, queryClient]);

  // Save on click-off: any pointer-down outside the textarea commits the draft
  // (no-ops when unchanged). Covers clicking elsewhere in the panel, another
  // tab, or the close button/backdrop — more reliable than focus-blur, which
  // can be skipped when the panel unmounts. Ref keeps the listener stable while
  // always calling the latest `save`.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = textareaRef.current;
      if (el && !el.contains(e.target as Node)) void saveRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  if (receivingId == null) {
    return (
      <Empty msg="No receiving row for this PO yet — notes will be available after the next Zoho sync." />
    );
  }

  return (
    <div>
      <label className="block text-eyebrow font-black uppercase tracking-wider text-text-soft">
        Carton notes
      </label>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={6}
        placeholder="Vendor context, claim handoff, anything the receiver should see…"
        className="mt-1 w-full rounded-md border border-border-soft bg-surface-card px-2 py-1.5 text-caption font-medium leading-snug text-text-default placeholder:text-text-faint focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
      />
      <div className="mt-2 text-eyebrow font-semibold text-text-faint">
        {saving ? 'Saving…' : 'Saves when you click away'}
      </div>
    </div>
  );
}
