import { useCallback, useMemo, useState } from 'react';

const PENDING_KEY = 'fba:pending_catalog';

function readPending(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean);
  } catch {
    return [];
  }
}

function writePending(list: string[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PENDING_KEY, JSON.stringify(Array.from(new Set(list))));
}

export function usePendingCatalog() {
  const [pending, setPending] = useState<string[]>(() => readPending());

  const addPending = useCallback((fnskus: string[]) => {
    if (!fnskus.length) return;
    setPending((prev) => {
      const merged = Array.from(new Set([...prev, ...fnskus.filter(Boolean)]));
      writePending(merged);
      return merged;
    });
  }, []);

  const removePending = useCallback((fnsku: string) => {
    setPending((prev) => {
      const next = prev.filter((f) => f !== fnsku);
      writePending(next);
      return next;
    });
  }, []);

  const clearPending = useCallback(() => {
    setPending(() => {
      writePending([]);
      return [];
    });
  }, []);

  const value = useMemo(
    () => ({ pending, addPending, removePending, clearPending }),
    [pending, addPending, removePending, clearPending]
  );

  return value;
}
