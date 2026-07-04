'use client';

/**
 * AssistantProvider — mounts the global assistant dock on every route
 * (plan §-2.1) and owns its open state + hotkey.
 *
 * Keyboard: cmd/ctrl+J toggles the dock — a modifier chord by design: the
 * scan-hotkey store owns bare function keys (F2 focus-scan) and CommandBar
 * owns cmd/ctrl+K, so cmd+J collides with neither. Never bind F-keys here.
 *
 * Gated on the signed-in user having the assistant.chat permission; renders
 * children untouched otherwise (public chrome, signed-out, unpermissioned).
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Sparkles } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { AssistantDock } from './AssistantDock';

const OPEN_KEY = 'assistant:dock-open';

/**
 * Whether the assistant dock is currently open (and permissioned/mounted).
 * `false` outside the provider or for unpermissioned users. StudioShell reads
 * this so it only lets the dock ABSORB the inspector when the dock is actually
 * visible — a closed dock must leave the classic aside/rail in place, else a
 * permissioned user who never opened it would have no inspector at all.
 */
const AssistantDockOpenContext = createContext(false);

export function useAssistantDockOpen(): boolean {
  return useContext(AssistantDockOpenContext);
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { user, has } = useAuth();
  const enabled = !!user && has('assistant.chat');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(OPEN_KEY) === '1');
    } catch {
      /* storage unavailable — default closed */
    }
  }, []);

  const setAndPersist = useCallback((next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'j') return;
      // Mirror CommandBar: don't OPEN over an editable field (closing is fine).
      const target = e.target as HTMLElement | null;
      const editable =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (editable && !open) return;
      e.preventDefault();
      setAndPersist(!open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, open, setAndPersist]);

  return (
    <AssistantDockOpenContext.Provider value={enabled && open}>
      {children}
      {enabled ? (
        <>
          <AssistantDock open={open} onClose={() => setAndPersist(false)} />
          {!open ? (
            <div className="fixed bottom-4 right-4 z-fab hidden lg:block">
              <HoverTooltip label="Assistant (⌘J)" focusable={false}>
                {/* ds-raw-button: circular FAB — no DS Button variant renders a round icon fab */}
                <button
                  type="button"
                  onClick={() => setAndPersist(true)}
                  aria-label="Open assistant"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700"
                >
                  <Sparkles className="h-5 w-5" />
                </button>
              </HoverTooltip>
            </div>
          ) : null}
        </>
      ) : null}
    </AssistantDockOpenContext.Provider>
  );
}
