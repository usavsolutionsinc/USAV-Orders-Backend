import type { HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { History, ShieldCheck, Truck } from '@/components/Icons';

/**
 * Top-level mode for the tech sidebar. Mirrors `ReceivingMode` on the
 * receiving page — primary affordance is the big pill row at the top, and
 * each mode owns a completely different sidebar body.
 *
 *   shipping → StationTesting (scan bar + UpNext). The right pane is fixed to
 *              the tech's History feed (the active/preview order crossfades
 *              over it); there is no sub-mode switcher.
 *   testing  → TestingSidebarPanel (scan bar + recent rail; no welcome/goal)
 *   history  → TestingHistoryList in the right pane (browse + bulk-select feed
 *              of this tech's tested lines). Promoted from the old Recent/History
 *              sub-tab to its own top-level mode (`view=testing-history`).
 */
export type TechSidebarTopMode = 'shipping' | 'testing' | 'history';

/**
 * Top-row pills shown in every mode. Matches the receiving sidebar's
 * `RECEIVING_MODE_ITEMS` shape (text + icon, `variant="nav"`) so the visual
 * vocabulary stays consistent across the app.
 */
export const TECH_TOP_MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'shipping', label: 'Shipping', icon: Truck },
  { id: 'testing', label: 'Testing', icon: ShieldCheck },
  { id: 'history', label: 'History', icon: History },
];
