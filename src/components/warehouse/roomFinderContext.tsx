'use client';

/**
 * Shared search-query state for the warehouse sidebar's rooms finder.
 *
 * The sidebar's top search bar (rendered in the header band by
 * WarehouseSidebarPanel) writes here; the rooms list below it
 * (RoomsSidebarList for the Rooms tab; LabelRoomSidebar for the Labels/
 * Racks tabs) reads here. One bar drives the whole surface so there's a
 * single, accessible search entry point per tab — no nested duplicates.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface RoomFinderContextValue {
  query: string;
  setQuery: (q: string) => void;
}

const RoomFinderContext = createContext<RoomFinderContextValue | null>(null);

export function RoomFinderProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  const value = useMemo(() => ({ query, setQuery }), [query]);
  return (
    <RoomFinderContext.Provider value={value}>{children}</RoomFinderContext.Provider>
  );
}

/**
 * Read/write the shared room-search query. Returns a no-op pair when used
 * outside a provider so consumers can render unconditionally.
 */
export function useRoomFinder(): RoomFinderContextValue {
  const ctx = useContext(RoomFinderContext);
  if (!ctx) return { query: '', setQuery: () => {} };
  return ctx;
}
