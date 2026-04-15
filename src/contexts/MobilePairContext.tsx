'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// Deliberately share the storage key with /m/scan so an already-paired phone
// that navigated to /m/scan and then browsed to another mobile page keeps its
// session visible to the FAB sheet.
const SESSION_STORAGE_KEY = 'usav.phonePair';

export type MobilePairSession = {
  staff_id: number;
  staff_name: string | null;
  phone_channel: string;
  station_channel: string;
  token_request: unknown;
  paired_at: number;
};

export type MobileScanStatus = 'pending' | 'sent' | 'matched' | 'unmatched' | 'error';

export type MobileScan = {
  id: string;
  tracking: string;
  status: MobileScanStatus;
  at: number;
  po_ids: string[];
  error: string | null;
};

type ClaimResponse = {
  success: boolean;
  staff_id?: number;
  staff_name?: string | null;
  phone_channel?: string;
  station_channel?: string;
  token_request?: unknown;
  error?: string;
};

type MobilePairContextValue = {
  session: MobilePairSession | null;
  connState: string;
  scans: MobileScan[];
  unreadEchoCount: number;
  markEchoesRead: () => void;
  claimCode: (code: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  disconnect: () => void;
  publishScan: (tracking: string) => void;
};

const MobilePairContext = createContext<MobilePairContextValue | null>(null);

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadSession(): MobilePairSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MobilePairSession;
    if (!parsed?.staff_id || !parsed.phone_channel || !parsed.token_request) return null;
    return parsed;
  } catch {
    return null;
  }
}

function storeSession(s: MobilePairSession | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (s) window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s));
    else window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* quota errors are non-fatal */
  }
}

export function MobilePairProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<MobilePairSession | null>(null);
  const [connState, setConnState] = useState<string>('idle');
  const [scans, setScans] = useState<MobileScan[]>([]);
  const [unreadEchoCount, setUnreadEchoCount] = useState(0);

  const realtimeRef = useRef<unknown>(null);
  const phoneChannelRef = useRef<unknown>(null);
  const stationChannelRef = useRef<unknown>(null);

  // Hydrate from sessionStorage on mount.
  useEffect(() => {
    const s = loadSession();
    if (s) setSession(s);
  }, []);

  // Mount/teardown the Ably connection whenever session changes. We keep the
  // client isolated from AblyProvider because the phone uses a per-device
  // token (publish on phone:{staffId}) — not the desktop API key.
  useEffect(() => {
    if (!session) {
      setConnState('idle');
      return;
    }

    let disposed = false;
    let realtime: any = null;
    let phoneChannel: any = null;
    let stationChannel: any = null;

    (async () => {
      try {
        const Ably = await import('ably');
        if (disposed) return;

        realtime = new Ably.Realtime({
          authCallback: (_params, cb) => {
            // token_request is the opaque TokenRequest issued by /api/pair/claim
            // via Ably.Rest.auth.createTokenRequest — safe to pass through.
            cb(null, session.token_request as Parameters<typeof cb>[1]);
          },
          clientId: `phone-${session.staff_id}`,
        });
        realtimeRef.current = realtime;

        phoneChannel = realtime.channels.get(session.phone_channel);
        phoneChannelRef.current = phoneChannel;

        stationChannel = realtime.channels.get(session.station_channel);
        stationChannelRef.current = stationChannel;

        const onState = (change: { current: string }) => {
          if (!disposed) setConnState(change.current);
        };
        realtime.connection.on(onState);
        setConnState(realtime.connection.state);

        const onResult = (msg: {
          data?: {
            tracking?: string;
            matched?: boolean;
            po_ids?: string[];
            error?: string | null;
          };
        }) => {
          const data = msg?.data;
          const tracking = (data?.tracking || '').trim();
          if (!tracking) return;
          let changed = false;
          setScans((prev) =>
            prev.map((s) => {
              if (s.tracking !== tracking || s.status === 'matched' || s.status === 'unmatched') {
                return s;
              }
              changed = true;
              if (data?.error) {
                return { ...s, status: 'error', error: data.error };
              }
              return {
                ...s,
                status: data?.matched ? 'matched' : 'unmatched',
                po_ids: Array.isArray(data?.po_ids) ? data!.po_ids! : [],
                error: null,
              };
            }),
          );
          // Bump the FAB badge whenever a new echo lands so the user sees a
          // dot until they open the sheet.
          if (changed) setUnreadEchoCount((n) => n + 1);
        };

        await stationChannel.subscribe('phone_scan_result', onResult);
      } catch (err) {
        console.warn('[mobile-pair] failed to connect realtime', err);
        if (!disposed) setConnState('failed');
      }
    })();

    return () => {
      disposed = true;
      try {
        stationChannel?.unsubscribe('phone_scan_result');
      } catch {}
      try {
        phoneChannel?.detach();
      } catch {}
      try {
        stationChannel?.detach();
      } catch {}
      try {
        realtime?.close();
      } catch {}
      realtimeRef.current = null;
      phoneChannelRef.current = null;
      stationChannelRef.current = null;
    };
  }, [session]);

  const claimCode = useCallback(
    async (codeRaw: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      const code = codeRaw.trim().toUpperCase();
      if (!code) return { ok: false, error: 'Pairing code is empty' };

      try {
        const res = await fetch('/api/pair/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = (await res.json()) as ClaimResponse;
        if (
          !data?.success ||
          !data.staff_id ||
          !data.phone_channel ||
          !data.station_channel ||
          !data.token_request
        ) {
          return { ok: false, error: data?.error || 'Pairing failed' };
        }
        const next: MobilePairSession = {
          staff_id: data.staff_id,
          staff_name: data.staff_name ?? null,
          phone_channel: data.phone_channel,
          station_channel: data.station_channel,
          token_request: data.token_request,
          paired_at: Date.now(),
        };
        storeSession(next);
        setSession(next);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Network error';
        return { ok: false, error: message };
      }
    },
    [],
  );

  const disconnect = useCallback(() => {
    storeSession(null);
    setSession(null);
    setScans([]);
    setUnreadEchoCount(0);
  }, []);

  const markEchoesRead = useCallback(() => setUnreadEchoCount(0), []);

  const publishScan = useCallback((rawValue: string) => {
    const tracking = rawValue.trim();
    if (!tracking) return;
    const phoneChannel = phoneChannelRef.current as
      | { publish: (event: string, data: unknown) => Promise<void> }
      | null;
    if (!phoneChannel) return;

    const id = randomId();
    const at = Date.now();
    setScans((prev) => {
      const fresh: MobileScan = { id, tracking, status: 'pending', at, po_ids: [], error: null };
      return [
        fresh,
        ...prev.filter(
          (s) => s.tracking !== tracking || (s.status !== 'pending' && s.status !== 'sent'),
        ),
      ].slice(0, 8);
    });

    phoneChannel
      .publish('phone_scan', { tracking, at })
      .then(() => {
        setScans((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'sent' } : s)));
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Publish failed';
        setScans((prev) =>
          prev.map((s) => (s.id === id ? { ...s, status: 'error', error: message } : s)),
        );
      });
  }, []);

  const value = useMemo<MobilePairContextValue>(
    () => ({
      session,
      connState,
      scans,
      unreadEchoCount,
      markEchoesRead,
      claimCode,
      disconnect,
      publishScan,
    }),
    [
      session,
      connState,
      scans,
      unreadEchoCount,
      markEchoesRead,
      claimCode,
      disconnect,
      publishScan,
    ],
  );

  return <MobilePairContext.Provider value={value}>{children}</MobilePairContext.Provider>;
}

export function useMobilePair(): MobilePairContextValue {
  const ctx = useContext(MobilePairContext);
  if (!ctx) {
    throw new Error('useMobilePair must be used inside <MobilePairProvider>');
  }
  return ctx;
}
