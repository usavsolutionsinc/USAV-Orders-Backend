'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Copy } from '@/components/Icons';

const CLOSE_DELAY_MS = 100;
const MARGIN = 8;
const CARET_PAD = 10;
const MAX_PLACEMENT_RETRIES = 8;

type SiteTooltipSession = {
  anchorId: string;
  value: string;
  copied: boolean;
  getRect: () => DOMRect | null;
};

export type SiteTooltipContextValue = {
  activate: (args: {
    anchorId: string;
    value: string;
    getRect: () => DOMRect | null;
  }) => void;
  scheduleClose: (anchorId: string) => void;
  closeNow: (anchorId: string) => void;
  syncValueIfActive: (anchorId: string, value: string) => void;
  notifyCopied: (anchorId: string) => void;
  isActiveAnchor: (anchorId: string) => boolean;
};

const SiteTooltipContext = createContext<SiteTooltipContextValue | null>(null);

export function useSiteTooltipOptional(): SiteTooltipContextValue | null {
  return useContext(SiteTooltipContext);
}

export function SiteTooltipProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SiteTooltipSession | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number } | null>(null);
  const [caretOffsetX, setCaretOffsetX] = useState(0);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAnchorIdRef = useRef<string | null>(null);
  const placementRetryRef = useRef(0);
  const isAnimatingRef = useRef(false);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const activate = useCallback(
    (args: { anchorId: string; value: string; getRect: () => DOMRect | null }) => {
      clearCloseTimer();
      placementRetryRef.current = 0;
      activeAnchorIdRef.current = args.anchorId;
      setTooltipPosition(null);
      setSession({
        anchorId: args.anchorId,
        value: args.value,
        copied: false,
        getRect: args.getRect,
      });
    },
    [clearCloseTimer]
  );

  const scheduleClose = useCallback(
    (anchorId: string) => {
      clearCloseTimer();
      closeTimerRef.current = setTimeout(() => {
        setSession((s) => {
          if (s?.anchorId === anchorId) {
            activeAnchorIdRef.current = null;
            return null;
          }
          return s;
        });
        setTooltipPosition(null);
        closeTimerRef.current = null;
      }, CLOSE_DELAY_MS);
    },
    [clearCloseTimer]
  );

  const closeNow = useCallback(
    (anchorId: string) => {
      clearCloseTimer();
      placementRetryRef.current = 0;
      setSession((s) => {
        if (s?.anchorId === anchorId) {
          activeAnchorIdRef.current = null;
          return null;
        }
        return s;
      });
      setTooltipPosition(null);
    },
    [clearCloseTimer]
  );

  const syncValueIfActive = useCallback((anchorId: string, value: string) => {
    setSession((s) => (s?.anchorId === anchorId ? { ...s, value } : s));
  }, []);

  const notifyCopied = useCallback((anchorId: string) => {
    setSession((s) => (s?.anchorId === anchorId ? { ...s, copied: true } : s));
    window.setTimeout(() => {
      setSession((s) => (s?.anchorId === anchorId ? { ...s, copied: false } : s));
    }, 1500);
  }, []);

  const sessionRef = useRef(session);
  sessionRef.current = session;

  const isActiveAnchor = useCallback(
    (anchorId: string) => sessionRef.current?.anchorId === anchorId,
    []
  );

  const updateTooltipPosition = useCallback(() => {
    if (!session || !tooltipRef.current) return;
    const chipRect = session.getRect();
    if (!chipRect || chipRect.width < 2 || chipRect.height < 2) {
      if (placementRetryRef.current < MAX_PLACEMENT_RETRIES) {
        placementRetryRef.current += 1;
        window.requestAnimationFrame(() => updateTooltipPosition());
      }
      return;
    }

    const tooltipEl = tooltipRef.current;
    const tooltipRect = tooltipEl.getBoundingClientRect();

    if (tooltipRect.width < 2 || tooltipRect.height < 2) {
      if (placementRetryRef.current < MAX_PLACEMENT_RETRIES) {
        placementRetryRef.current += 1;
        window.requestAnimationFrame(() => updateTooltipPosition());
      }
      return;
    }

    const bubbleAnchorX = chipRect.left + chipRect.width / 2;

    const centeredLeft = bubbleAnchorX - tooltipRect.width / 2;
    const minLeft = MARGIN;
    const maxLeft = Math.max(minLeft, window.innerWidth - tooltipRect.width - MARGIN);
    const left = Math.min(Math.max(centeredLeft, minLeft), maxLeft);

    const spaceAbove = chipRect.top - MARGIN;
    const spaceBelow = window.innerHeight - chipRect.bottom - MARGIN;
    const preferAbove = spaceAbove >= tooltipRect.height || spaceAbove > spaceBelow;
    const rawTop = preferAbove ? chipRect.top - tooltipRect.height - MARGIN : chipRect.bottom + MARGIN;
    const minTop = MARGIN;
    const maxTop = Math.max(minTop, window.innerHeight - tooltipRect.height - MARGIN);
    const top = Math.min(Math.max(rawTop, minTop), maxTop);

    const rawCaret = bubbleAnchorX - left;
    const caretX = Math.min(Math.max(rawCaret, CARET_PAD), tooltipRect.width - CARET_PAD);

    placementRetryRef.current = 0;
    setTooltipPosition({ top, left });
    setCaretOffsetX(caretX);
  }, [session]);

  const open = !!session;

  // Reposition on scroll / resize
  useEffect(() => {
    if (!open) return;
    const rafId = window.requestAnimationFrame(updateTooltipPosition);
    const handleReposition = () => updateTooltipPosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [open, updateTooltipPosition]);

  // Position on session change
  useLayoutEffect(() => {
    if (!open) return;
    updateTooltipPosition();
    const id = window.requestAnimationFrame(() => updateTooltipPosition());
    return () => window.cancelAnimationFrame(id);
  }, [open, session, updateTooltipPosition]);

  // Reposition when tooltip resizes (skip during layout animation)
  useEffect(() => {
    if (!open || !tooltipRef.current) return;
    const el = tooltipRef.current;
    const ro = new ResizeObserver(() => {
      if (!isAnimatingRef.current) updateTooltipPosition();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, updateTooltipPosition]);

  const handleLayoutAnimStart = useCallback(() => {
    isAnimatingRef.current = true;
  }, []);

  const handleLayoutAnimComplete = useCallback(() => {
    isAnimatingRef.current = false;
  }, []);

  const api = useMemo(
    () => ({
      activate,
      scheduleClose,
      closeNow,
      syncValueIfActive,
      notifyCopied,
      isActiveAnchor,
    }),
    [activate, scheduleClose, closeNow, syncValueIfActive, notifyCopied, isActiveAnchor]
  );

  const placementReady = tooltipPosition != null;

  const portal =
    typeof document !== 'undefined'
      ? createPortal(
          open && session ? (
            <div
              ref={tooltipRef}
              style={{
                top: tooltipPosition?.top ?? -9999,
                left: tooltipPosition?.left ?? -9999,
                visibility: placementReady ? 'visible' : 'hidden',
                opacity: placementReady ? 1 : 0,
                transition: 'opacity 0.15s ease-out',
              }}
              className="pointer-events-none fixed z-[2147483647]"
            >
              {/* Shell — layout-animated width via Framer Motion */}
              <motion.div
                layout
                onLayoutAnimationStart={handleLayoutAnimStart}
                onLayoutAnimationComplete={handleLayoutAnimComplete}
                transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                style={{ overflow: 'hidden' }}
                className="flex max-w-[min(90vw,24rem)] items-start gap-2 rounded-md bg-gray-900 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-md"
              >
                <AnimatePresence mode="popLayout">
                  <motion.div
                    key={session.anchorId}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.12 }}
                    className="flex items-start gap-2"
                  >
                    <span className="font-mono whitespace-nowrap leading-tight">
                      {session.value}
                    </span>
                    {session.copied ? (
                      <Check className="h-3 w-3 shrink-0 text-emerald-400" />
                    ) : (
                      <Copy className="h-3 w-3 shrink-0 text-gray-500" />
                    )}
                  </motion.div>
                </AnimatePresence>
              </motion.div>
              {/* Caret — layout-animated position to stay in sync with shell */}
              <motion.span
                layout="position"
                transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                className="absolute border-x-4 border-b-0 border-t-4 border-x-transparent border-t-gray-900"
                style={{ left: caretOffsetX, transform: 'translateX(-50%)' }}
              />
            </div>
          ) : null,
          document.body
        )
      : null;

  return (
    <SiteTooltipContext.Provider value={api}>
      {children}
      {portal}
    </SiteTooltipContext.Provider>
  );
}
