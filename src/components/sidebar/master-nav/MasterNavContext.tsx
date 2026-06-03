'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Signals to per-route sidebar panels that the master nav is driving page+mode,
 * so they should suppress their OWN mode pill-row (the L2 `ModeRail` in the
 * master nav header is the single switcher). Lets P2 swap in the master nav
 * behind a flag without a double switcher and without deleting panel code yet —
 * the panels just gate their pill-row on `!useMasterNavEnabled()`.
 */
const MasterNavContext = createContext(false);

export function MasterNavProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <MasterNavContext.Provider value={enabled}>{children}</MasterNavContext.Provider>;
}

/** True when the master nav owns mode switching (panels should hide their pills). */
export function useMasterNavEnabled(): boolean {
  return useContext(MasterNavContext);
}
