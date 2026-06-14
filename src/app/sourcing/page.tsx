'use client';

/**
 * /sourcing — the universal sourcing operational hub (demand → scour → acquire).
 *
 * Master-nav page with modes (Queue / Scout / Watchlist). The sidebar is
 * owned by DashboardSidebar on desktop (SidebarContextPanel → SourcingSidebarPanel)
 * and mounts via RouteShell's `actions` slot on mobile. Permission gating is
 * enforced by middleware via ROUTE_PERMISSIONS ('/sourcing' → 'sourcing.view').
 */

import { RouteShell } from '@/design-system/components/RouteShell';
import { SourcingSidebarPanel } from '@/components/sidebar/SourcingSidebarPanel';
import { SourcingWorkspace } from '@/components/sourcing/SourcingWorkspace';

export default function SourcingPage() {
  return (
    <RouteShell
      actions={<SourcingSidebarPanel />}
      history={<SourcingWorkspace />}
      actionsLabel="Sourcing"
      historyLabel="Results"
    />
  );
}
