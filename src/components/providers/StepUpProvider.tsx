'use client';

/**
 * Global step-up gate. Any client caller that hits a `403 STEPUP_REQUIRED`
 * response can ask the user to re-confirm (PIN / passkey) via this provider's
 * `requestStepUp(scope)` and then retry the original request.
 *
 * Pair it with {@link fetchWithStepUp} from `@/components/auth/StepUpModal`,
 * which calls `requestStepUp(scope)` automatically on a 403 and retries once.
 */

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { StepUpModal } from '@/components/auth/StepUpModal';

type RequestStepUp = (scope: string, reason?: string) => Promise<boolean>;

const StepUpContext = createContext<RequestStepUp | null>(null);

interface PendingStepUp {
  scope: string;
  reason?: string;
  resolve: (granted: boolean) => void;
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingStepUp | null>(null);
  // Mirror in a ref so settle() always sees the live pending request even if it
  // fires from a stale closure.
  const pendingRef = useRef<PendingStepUp | null>(null);
  pendingRef.current = pending;

  const requestStepUp = useCallback<RequestStepUp>((scope, reason) => {
    return new Promise<boolean>((resolve) => {
      setPending({ scope, reason, resolve });
    });
  }, []);

  const settle = useCallback((granted: boolean) => {
    const current = pendingRef.current;
    setPending(null);
    current?.resolve(granted);
  }, []);

  return (
    <StepUpContext.Provider value={requestStepUp}>
      {children}
      <StepUpModal
        scope={pending?.scope ?? ''}
        reason={pending?.reason}
        open={pending !== null}
        onResolved={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </StepUpContext.Provider>
  );
}

const NO_PROVIDER: RequestStepUp = async () => false;

/**
 * Returns `requestStepUp(scope, reason?)`. Opens the global step-up modal and
 * resolves `true` once the user completes PIN / passkey, `false` if they cancel.
 * Outside a provider it resolves `false` so callers degrade to the original 403.
 */
export function useStepUp(): RequestStepUp {
  return useContext(StepUpContext) ?? NO_PROVIDER;
}
