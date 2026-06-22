'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const DEFAULT_RATIO = 0.65;
const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

function readPersistedRatio(key: string | undefined, fallback: number): number {
  if (!key || typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(`${key}.splitRatio`);
    if (!raw) return fallback;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, parsed));
  } catch {
    return fallback;
  }
}

export interface UseVerticalSplitDragOptions {
  /** When set, ratio persists under `${persistKey}.splitRatio`. */
  persistKey?: string;
  defaultRatio?: number;
  /** Disable drag (flex-only layout). */
  enabled?: boolean;
}

export interface VerticalSplitDividerProps {
  role: 'separator';
  'aria-orientation': 'horizontal';
  'aria-label': string;
  'aria-valuenow': number;
  tabIndex: number;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}

/**
 * Ratio-based vertical split drag for stacked panes inside a flex column.
 * Extracted from the listing preview splitter — generalized to 0–1 top/bottom
 * weights instead of pixel iframe height.
 */
export function useVerticalSplitDrag({
  persistKey,
  defaultRatio = DEFAULT_RATIO,
  enabled = true,
}: UseVerticalSplitDragOptions = {}) {
  const [ratio, setRatioState] = useState(() => readPersistedRatio(persistKey, defaultRatio));
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startRatio: number } | null>(null);

  const setRatio = useCallback(
    (next: number) => {
      const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, next));
      setRatioState(clamped);
      if (persistKey) {
        try {
          window.localStorage.setItem(`${persistKey}.splitRatio`, String(clamped));
        } catch {
          /* noop */
        }
      }
    },
    [persistKey],
  );

  useEffect(() => {
    if (!persistKey) return;
    setRatioState(readPersistedRatio(persistKey, defaultRatio));
  }, [persistKey, defaultRatio]);

  const stopDrag = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { startY: e.clientY, startRatio: ratio };
      setIsDragging(true);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
    },
    [enabled, ratio],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current || !enabled) return;
      const container = e.currentTarget.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const available = Math.max(1, rect.height - e.currentTarget.offsetHeight);
      const delta = e.clientY - dragRef.current.startY;
      setRatio(dragRef.current.startRatio + delta / available);
    },
    [enabled, setRatio],
  );

  const onDoubleClick = useCallback(() => {
    setRatio(defaultRatio);
  }, [defaultRatio, setRatio]);

  const dividerProps: VerticalSplitDividerProps = {
    role: 'separator',
    'aria-orientation': 'horizontal',
    'aria-label': 'Resize sections (drag, or double-click to reset)',
    'aria-valuenow': Math.round(ratio * 100),
    tabIndex: enabled ? 0 : -1,
    onPointerDown,
    onPointerMove,
    onPointerUp: stopDrag,
    onPointerCancel: stopDrag,
    onDoubleClick,
  };

  return { ratio, setRatio, isDragging, dividerProps };
}
