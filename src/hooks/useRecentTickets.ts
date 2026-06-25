'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Recently-opened Zendesk tickets, persisted to localStorage so the support
 * sidebar can show a "Recently opened" group at the top of the queue (per the
 * brief: recents live in the sidebar, not an overhead bar). Capped + de-duped.
 */
export interface RecentTicket {
  id: number;
  subject: string | null;
  status: string;
  priority: string | null;
  at: number;
}

const KEY = 'support:recent-tickets';
const MAX = 8;
const EVENT = 'support:recents-changed';

function read(): RecentTicket[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as RecentTicket[]) : [];
  } catch {
    return [];
  }
}

export function useRecentTickets() {
  const [recents, setRecents] = useState<RecentTicket[]>([]);

  useEffect(() => {
    setRecents(read());
    // Sync across tabs + across hook instances in the same tab.
    const sync = () => setRecents(read());
    window.addEventListener('storage', sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);

  const push = useCallback((t: Omit<RecentTicket, 'at'>) => {
    const next = [{ ...t, at: Date.now() }, ...read().filter((p) => p.id !== t.id)].slice(0, MAX);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage disabled / quota — recents are best-effort */
    }
    setRecents(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setRecents([]);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { recents, push, clear };
}
