import type { HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { Clock, List, PackageCheck, ShieldCheck, Truck } from '@/components/Icons';

/**
 * `TechStationViewMode` controls the right-panel table inside the Shipping
 * top-mode (history / pending / shipped). The 'testing' top-mode does not
 * use this — it owns its own workspace.
 */
export type TechStationViewMode = 'history' | 'shipped' | 'pending';

/**
 * Top-level mode for the tech sidebar. Mirrors `ReceivingMode` on the
 * receiving page — primary affordance is the big pill row at the top, and
 * each mode owns a completely different sidebar body.
 *
 *   shipping → StationTesting (welcome + goal + scan bar + UpNext + view icons)
 *   testing  → TestingSidebarPanel (scan bar + recent rail; no welcome/goal)
 */
export type TechSidebarTopMode = 'shipping' | 'testing';

/** Icon-only sub-mode pills shown ONLY in the Shipping top mode. */
export const TECH_STATION_VIEW_ITEMS: HorizontalSliderItem[] = [
  { id: 'history', label: 'History', icon: List },
  { id: 'shipped', label: 'Shipped', icon: PackageCheck },
  { id: 'pending', label: 'Pending', icon: Clock },
];

/**
 * Top-row pills shown in both modes. Matches the receiving sidebar's
 * `RECEIVING_MODE_ITEMS` shape (text + icon, `variant="nav"`) so the visual
 * vocabulary stays consistent across the app.
 */
export const TECH_TOP_MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'shipping', label: 'Shipping', icon: Truck },
  { id: 'testing', label: 'Testing', icon: ShieldCheck },
];

/** Passed when the right pane uses a route not in this strip (e.g. `view=receiving`). */
export const TECH_STATION_VIEW_SLIDER_NONE = '__tech_view_none__' as const;
