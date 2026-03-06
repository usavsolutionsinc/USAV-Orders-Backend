'use client';

import { createContext, useContext, useEffect, useRef, ReactNode } from 'react';

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

  const getClient = (): Promise<any | null> => {
    if (readyRef.current) return Promise.resolve(clientRef.current);
    return new Promise<any | null>((resolve) => {
      pendingRef.current.push(resolve);
    });
  };

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
    <AblyContext.Provider value={{ getClient }}>
      {children}
    </AblyContext.Provider>
  );
}

export function useAblyClient() {
  return useContext(AblyContext);
}
