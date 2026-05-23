'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, ReactNode } from 'react';

interface AblyContextValue {
  /** Returns the shared Ably Realtime client (or null if unavailable). */
  getClient: () => Promise<any | null>;
}

const AblyContext = createContext<AblyContextValue>({
  getClient: () => Promise.resolve(null),
});

/**
 * AblyProvider — mounts exactly ONE Ably Realtime connection for the whole app.
 * All data hooks share this single connection via useAblyChannel(), which prevents
 * the per-hook client pattern from exhausting Ably concurrent-connection limits.
 */
export function AblyProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<any>(null);
  const pendingRef = useRef<((client: any | null) => void)[]>([]);
  const readyRef = useRef(false);

  // useCallback with empty deps so the returned function is referentially
  // stable across renders. Without this, every parent re-render minted a new
  // `getClient` → new context value → all consumer effects that listed
  // `getClient` in their deps re-fired, which is how the packer wizard
  // publish-state effect ended up flooding Ably at >1000 msg/s.
  const getClient = useCallback((): Promise<any | null> => {
    if (readyRef.current) return Promise.resolve(clientRef.current);
    return new Promise<any | null>((resolve) => {
      pendingRef.current.push(resolve);
    });
  }, []);

  const contextValue = useMemo(() => ({ getClient }), [getClient]);

  useEffect(() => {
    let disposed = false;
    const authUrl =
      process.env.NEXT_PUBLIC_ABLY_AUTH_PATH || '/api/realtime/token';

    import('ably')
      .then((Ably) => {
        if (disposed) return;
        const client = new Ably.Realtime({ authUrl });
        clientRef.current = client;
        readyRef.current = true;
        pendingRef.current.forEach((r) => r(client));
        pendingRef.current = [];
      })
      .catch((err) => {
        console.error('[ably] Failed to initialise client:', err);
        readyRef.current = true;
        pendingRef.current.forEach((r) => r(null));
        pendingRef.current = [];
      });

    return () => {
      disposed = true;
      try {
        clientRef.current?.close();
      } catch {}
      clientRef.current = null;
      readyRef.current = false;
    };
  }, []);

  return (
    <AblyContext.Provider value={contextValue}>
      {children}
    </AblyContext.Provider>
  );
}

export function useAblyClient() {
  return useContext(AblyContext);
}
