'use client';

/**
 * AssistantProvider — mounts the global assistant dock on every route
 * (plan §-2.1) and owns its open state + hotkey.
 *
 * Keyboard: cmd/ctrl+J toggles the dock. Opening focuses the chat composer;
 * closing does not. Modifier chord by design: scan-hotkey store owns bare
 * F-keys, CommandBar owns cmd+K.
 *
 * Gated on the signed-in user having the assistant.chat permission; renders
 * children untouched otherwise (public chrome, signed-out, unpermissioned).
 */

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { RightRailHost } from '@/components/right-rail/RightRailHost';
import { GlobalDetailStackHost } from '@/components/detail-stacks/GlobalDetailStackHost';
import { useRegisterRightPanel } from '@/components/right-rail/useRegisterRightPanel';
import { RIGHT_RAIL_PRIORITY } from '@/lib/right-rail/store';
import { AssistantDockBody } from './AssistantDock';
import { DetailStackHistoryTracker } from './DetailStackHistoryTracker';
import { requestComposerFocus } from '@/lib/assistant/composer-focus-store';

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

/**
 * Open state + setter for the assistant panel, exposed so the Sparkles entry in
 * GlobalHeaderActions (a provider descendant) can toggle it. `enabled` mirrors
 * the permission gate so the header entry hides entirely for unpermissioned
 * users.
 */
interface AssistantDockControls {
  open: boolean;
  enabled: boolean;
  setOpen: (next: boolean) => void;
  /** Focus the chat composer (caret at end). Safe before the dock has mounted. */
  focusComposer: () => void;
}

const AssistantDockControlsContext = createContext<AssistantDockControls>({
  open: false,
  enabled: false,
  setOpen: () => {},
  focusComposer: () => {},
});

export function useAssistantDockControls(): AssistantDockControls {
  return useContext(AssistantDockControlsContext);
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

  const focusComposer = useCallback(() => {
    requestComposerFocus();
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'j') return;
      e.preventDefault();
      const next = !open;
      setAndPersist(next);
      if (next) focusComposer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, open, setAndPersist, focusComposer]);

  const closeDock = useCallback(() => setAndPersist(false), [setAndPersist]);

  const controls = useMemo<AssistantDockControls>(
    () => ({ open, enabled, setOpen: setAndPersist, focusComposer }),
    [open, enabled, setAndPersist, focusComposer],
  );

  return (
    <AssistantDockControlsContext.Provider value={controls}>
      <AssistantDockOpenContext.Provider value={enabled && open}>
        {children}
        {/* Always mounted — detail stacks register here even when the user
            lacks assistant.chat permission. */}
        <RightRailHost />
        <GlobalDetailStackHost />
        {enabled ? (
          <>
            <AssistantRailRegistrant open={open} onClose={closeDock} />
            <Suspense fallback={null}>
              <DetailStackHistoryTracker />
            </Suspense>
          </>
        ) : null}
      </AssistantDockOpenContext.Provider>
    </AssistantDockControlsContext.Provider>
  );
}

/**
 * Registers the assistant body as the `assistant` occupant of the right rail
 * while the dock is open. Rendering the body up through the store (not here)
 * keeps it mounted under the single RightRailHost, so its chat/draft/scroll
 * state lives in one place.
 */
function AssistantRailRegistrant({ open, onClose }: { open: boolean; onClose: () => void }) {
  useRegisterRightPanel({
    id: 'assistant',
    priority: RIGHT_RAIL_PRIORITY.assistant,
    node: <AssistantDockBody onClose={onClose} />,
    onClose,
    enabled: open,
  });
  return null;
}
