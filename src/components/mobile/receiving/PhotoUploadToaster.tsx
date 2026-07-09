'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { AnimatedCheck } from '@/components/ui/AnimatedCheck';
import { useUploadQueue } from '@/components/mobile/receiving/PhotoUploadQueue';

/** Turn a raw upload error into a human, actionable line. */
function humanizeUploadError(raw: string): string {
  const v = raw.trim();
  if (/forbidden/i.test(v)) return "You don't have permission to add photos here.";
  if (/^upload failed \(401\)/i.test(v) || /unauthor/i.test(v)) return 'Signed out — sign in and retry.';
  if (/bucket/i.test(v) && /exist/i.test(v)) return 'Photo storage isn’t set up (bucket missing). Tell an admin.';
  if (/network|failed to fetch|load failed/i.test(v)) return 'Network dropped — retry from the gallery.';
  if (/storage|nas|adapter|gcs|blob|bucket/i.test(v)) return 'Storage is unreachable — retry shortly.';
  return v || 'Upload failed';
}

/**
 * Mounted once in the mobile shell. Watches the receiving photo-upload queue and
 * surfaces the *real* outcome of each background upload:
 *   • done   → a top success toast with an animated checkmark.
 *   • failed → a top error toast carrying the server's reason (403, storage, …).
 *
 * The capture surface fires only an optimistic "Uploading…" toast and then
 * navigates away, so without this the actual result was never shown — a silent
 * failure read as "photos don't upload at all". This closes that loop and makes
 * any failure visible/diagnosable.
 *
 * Completions are coalesced over a short window so a burst of N photos yields a
 * single "N photos submitted" toast instead of N stacked toasts.
 */
export function PhotoUploadToaster() {
  const entries = useUploadQueue();

  // Per-entry terminal-state dedupe so each upload toasts exactly once.
  const notifiedDone = useRef<Set<string>>(new Set());
  const notifiedFailed = useRef<Set<string>>(new Set());

  // Coalesce buffers + flush timers.
  const pendingDone = useRef(0);
  const pendingFailed = useRef<string[]>([]);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let sawDone = false;
    let sawFailed = false;

    for (const e of entries) {
      if (e.state === 'done' && !notifiedDone.current.has(e.id)) {
        notifiedDone.current.add(e.id);
        pendingDone.current += 1;
        sawDone = true;
      } else if (e.state === 'failed' && !notifiedFailed.current.has(e.id)) {
        notifiedFailed.current.add(e.id);
        pendingFailed.current.push(e.error || 'Upload failed');
        sawFailed = true;
      }
    }

    if (sawDone) {
      if (doneTimer.current) clearTimeout(doneTimer.current);
      doneTimer.current = setTimeout(() => {
        const n = pendingDone.current;
        pendingDone.current = 0;
        if (n <= 0) return;
        toast.success(`${n} photo${n === 1 ? '' : 's'} submitted`, {
          description: 'Saved successfully.',
          icon: <AnimatedCheck size={18} />,
          position: 'top-center',
          duration: 3500,
        });
      }, 500);
    }

    if (sawFailed) {
      if (failTimer.current) clearTimeout(failTimer.current);
      failTimer.current = setTimeout(() => {
        const reasons = pendingFailed.current;
        pendingFailed.current = [];
        if (reasons.length === 0) return;
        const n = reasons.length;
        toast.error(
          n === 1 ? 'Photo upload failed' : `${n} photo uploads failed`,
          {
            description: humanizeUploadError(reasons[0]),
            position: 'top-center',
            duration: 8000,
          },
        );
      }, 500);
    }
  }, [entries]);

  // Clear timers on unmount.
  useEffect(() => {
    return () => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
      if (failTimer.current) clearTimeout(failTimer.current);
    };
  }, []);

  return null;
}
