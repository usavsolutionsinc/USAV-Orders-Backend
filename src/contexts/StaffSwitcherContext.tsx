'use client';

/**
 * Tiny client context so any component (sidebar chips, page banners) can
 * trigger the FAB's SwitchStaffSheet without prop-drilling.
 *
 *   const { openSwitcher } = useStaffSwitcher();
 *   <button onClick={openSwitcher}>Switch ↗</button>
 *
 * The provider is mounted next to QuickAccessFab in ResponsiveLayout.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface StaffSwitcherCtx {
  openSwitcher: () => void;
  closeSwitcher: () => void;
  isOpen: boolean;
}

const Ctx = createContext<StaffSwitcherCtx>({
  openSwitcher: () => {},
  closeSwitcher: () => {},
  isOpen: false,
});

export function StaffSwitcherProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const openSwitcher = useCallback(() => setOpen(true), []);
  const closeSwitcher = useCallback(() => setOpen(false), []);
  const value = useMemo<StaffSwitcherCtx>(
    () => ({ openSwitcher, closeSwitcher, isOpen }),
    [openSwitcher, closeSwitcher, isOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStaffSwitcher(): StaffSwitcherCtx {
  return useContext(Ctx);
}
