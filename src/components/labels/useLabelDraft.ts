'use client';

import { useEffect, useState } from 'react';

/**
 * Draft state for a label editor: holds the working copy, re-seeds it from the
 * record every time the editor (re)opens (so it never shows a stale draft from a
 * previous edit / line), and exposes a typed field setter. Shared by the
 * receiving and (future) testing label editors.
 *
 * `defaults` is intentionally NOT an effect dependency — callers typically
 * re-derive it every render, and depending on it would clobber the live draft
 * on each keystroke. The reseed is keyed on the open transition only.
 */
export function useLabelDraft<T extends object>(defaults: T, open: boolean) {
  const [draft, setDraft] = useState<T>(defaults);

  useEffect(() => {
    if (open) setDraft(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends keyof T>(key: K, value: T[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return { draft, setDraft, set };
}
