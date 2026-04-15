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

export type PairState = 'unpaired' | 'pairing' | 'paired';

export type PhoneScanStatus = 'pending' | 'matched' | 'unmatched' | 'error';

export type PhoneScanRecord = {
  id: string;
  tracking: string;
  status: PhoneScanStatus;
  po_ids: string[];
  receiving_id: number | null;
  error: string | null;
  at: number;
};

export type PairedSession = {
  staffId: number;
  staffName: string | null;
  pairedAt: number;
};

type PhonePairContextValue = {
  pairState: PairState;
  session: PairedSession | null;
  lastScan: PhoneScanRecord | null;
  unreadScanCount: number;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  markScansRead: () => void;
  disconnect: () => void;
  // Called by the modal once the phone has claimed the pairing code.
  confirmPaired: (session: PairedSession) => void;
  // Called by the scan bridge when a new phone scan arrives or resolves.
  recordScan: (scan: PhoneScanRecord) => void;
  updateScan: (id: string, patch: Partial<PhoneScanRecord>) => void;
};

const STORAGE_KEY = 'usav.deskPair.v1';
// Match Ably token TTL in /api/pair/claim (4 hours).
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

const PhonePairContext = createContext<PhonePairContextValue | null>(null);

function readStored(): PairedSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PairedSession | null;
    if (!parsed || !parsed.staffId || !parsed.pairedAt) return null;
    if (Date.now() - parsed.pairedAt > SESSION_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(session: PairedSession | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* quota errors are non-fatal */
  }
}

export function PhonePairProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PairedSession | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [lastScan, setLastScan] = useState<PhoneScanRecord | null>(null);
  const [unreadScanCount, setUnreadScanCount] = useState(0);
  const expiryTimerRef = useRef<number | null>(null);

  // Hydrate once on mount.
  useEffect(() => {
    const stored = readStored();
    if (stored) setSession(stored);
  }, []);

  // Expire the session when the token TTL runs out so the FAB flips back
  // to "unpaired" without the user needing to refresh.
  useEffect(() => {
    if (expiryTimerRef.current) {
      window.clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    if (!session) return;
    const remaining = Math.max(0, session.pairedAt + SESSION_TTL_MS - Date.now());
    if (remaining === 0) {
      setSession(null);
      writeStored(null);
      return;
    }
    expiryTimerRef.current = window.setTimeout(() => {
      setSession(null);
      writeStored(null);
    }, remaining);
    return () => {
      if (expiryTimerRef.current) window.clearTimeout(expiryTimerRef.current);
    };
  }, [session]);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  const confirmPaired = useCallback((next: PairedSession) => {
    setSession(next);
    writeStored(next);
    // Fresh pair clears any stale scan badge from a previous session.
    setUnreadScanCount(0);
    setLastScan(null);
  }, []);

  const disconnect = useCallback(() => {
    setSession(null);
    writeStored(null);
    setUnreadScanCount(0);
    setLastScan(null);
  }, []);

  const markScansRead = useCallback(() => setUnreadScanCount(0), []);

  const recordScan = useCallback((scan: PhoneScanRecord) => {
    setLastScan(scan);
    setUnreadScanCount((n) => n + 1);
  }, []);

  const updateScan = useCallback((id: string, patch: Partial<PhoneScanRecord>) => {
    setLastScan((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }, []);

  const pairState: PairState = session ? 'paired' : modalOpen ? 'pairing' : 'unpaired';

  const value = useMemo<PhonePairContextValue>(
    () => ({
      pairState,
      session,
      lastScan,
      unreadScanCount,
      modalOpen,
      openModal,
      closeModal,
      markScansRead,
      disconnect,
      confirmPaired,
      recordScan,
      updateScan,
    }),
    [
      pairState,
      session,
      lastScan,
      unreadScanCount,
      modalOpen,
      openModal,
      closeModal,
      markScansRead,
      disconnect,
      confirmPaired,
      recordScan,
      updateScan,
    ],
  );

  return <PhonePairContext.Provider value={value}>{children}</PhonePairContext.Provider>;
}

export function usePhonePair(): PhonePairContextValue {
  const ctx = useContext(PhonePairContext);
  if (!ctx) {
    throw new Error('usePhonePair must be used inside <PhonePairProvider>');
  }
  return ctx;
}
