import { useEffect, useRef, useState } from 'react';
import type { ClaimType } from '@/components/sidebar/receiving/receiving-sidebar-shared';

export interface UseClaimTemplate {
  subject: string;
  description: string;
  previewLoading: boolean;
  /** True once the operator has manually edited subject or body. */
  edited: boolean;
  onSubjectChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  /** Re-fetch the server template and overwrite the editable fields. */
  resetTemplate: () => void;
  /** Read the latest values without re-rendering (for submit/draft payloads). */
  readSubject: () => string;
  readDescription: () => string;
}

interface Params {
  open: boolean;
  /** Only fetch the preview on the create→internal step. */
  active: boolean;
  receivingId: number | null | undefined;
  lineId: number | null | undefined;
  claimType: ClaimType;
  reason: string;
}

/**
 * Owns the editable Zendesk ticket template. Fetches the server-rendered
 * preview (PO #, tracking, photo URLs, line summary) whenever inputs change —
 * debounced 250ms so typing in "reason" doesn't hammer the endpoint — and stops
 * overwriting a field once the operator has touched it. "Reset to template"
 * clears the touched flags and forces a refetch.
 */
export function useClaimTemplate({ open, active, receivingId, lineId, claimType, reason }: Params): UseClaimTemplate {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [edited, setEdited] = useState(false);
  const subjectTouched = useRef(false);
  const descriptionTouched = useRef(false);
  // Bumped by resetTemplate to force the preview effect to re-run even when the
  // upstream inputs are unchanged.
  const [resetNonce, setResetNonce] = useState(0);
  const subjectRef = useRef('');
  const descriptionRef = useRef('');
  subjectRef.current = subject;
  descriptionRef.current = description;

  // Clear the template each time the modal opens so reopening on a different
  // row never shows stale text.
  useEffect(() => {
    if (!open) return;
    setSubject('');
    setDescription('');
    setEdited(false);
    subjectTouched.current = false;
    descriptionTouched.current = false;
  }, [open, receivingId, lineId]);

  useEffect(() => {
    if (!open || !active || !receivingId) return;
    const ctrl = new AbortController();
    const handle = window.setTimeout(() => {
      setPreviewLoading(true);
      fetch('/api/receiving/zendesk-claim/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivingId,
          lineId,
          claimType,
          reason: reason.trim(),
        }),
        signal: ctrl.signal,
      })
        .then((r) => r.json().catch(() => null))
        .then((data) => {
          if (!data?.success) return;
          if (!subjectTouched.current && typeof data.subject === 'string') {
            setSubject(data.subject);
          }
          if (!descriptionTouched.current && typeof data.description === 'string') {
            setDescription(data.description);
          }
        })
        .catch((err) => {
          if ((err as Error)?.name !== 'AbortError') {
            // Preview is best-effort — operator can still type their own.
          }
        })
        .finally(() => setPreviewLoading(false));
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(handle);
    };
  }, [open, active, receivingId, lineId, claimType, reason, resetNonce]);

  const onSubjectChange = (v: string) => {
    subjectTouched.current = true;
    setEdited(true);
    setSubject(v);
  };

  const onDescriptionChange = (v: string) => {
    descriptionTouched.current = true;
    setEdited(true);
    setDescription(v);
  };

  const resetTemplate = () => {
    subjectTouched.current = false;
    descriptionTouched.current = false;
    setEdited(false);
    // Force a refetch so the fields repopulate from the server template.
    setResetNonce((n) => n + 1);
  };

  return {
    subject,
    description,
    previewLoading,
    edited,
    onSubjectChange,
    onDescriptionChange,
    resetTemplate,
    readSubject: () => subjectRef.current,
    readDescription: () => descriptionRef.current,
  };
}
