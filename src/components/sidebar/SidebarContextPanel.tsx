'use client';

import { usePathname } from 'next/navigation';
import { WalkInSidebarPanel } from '@/components/sidebar/WalkInSidebarPanel';
import { OutboundSidebarPanel } from '@/components/sidebar/OutboundSidebarPanel';
import { ManualsLibrarySidebar } from '@/components/manuals/ManualsLibrarySidebar';
import { ProductsSidebarPanel } from '@/components/sidebar/ProductsSidebarPanel';
import { TechSidebarPanel } from '@/components/sidebar/TechSidebarPanel';
import { PackerSidebarPanel } from '@/components/sidebar/PackerSidebarPanel';
import { ReceivingSidebarPanel } from '@/components/sidebar/ReceivingSidebarPanel';
import { StudioSidebarPanel } from '@/components/sidebar/StudioSidebarPanel';
import { InventorySidebarPanel } from '@/components/sidebar/InventorySidebarPanel';
import { SourcingSidebarPanel } from '@/components/sidebar/SourcingSidebarPanel';
import { WarehouseSidebarPanel } from '@/components/sidebar/WarehouseSidebarPanel';
import { FbaSidebarPanel } from '@/components/fba/sidebar';
import { SupportSidebarPanel } from '@/components/sidebar/SupportSidebarPanel';
import { AiChatSidebarPanel } from '@/components/sidebar/AiChatSidebarPanel';
import { SettingsSidebar } from '@/components/sidebar/SettingsSidebarPanel';
import { AuditLogSidebarPanel } from '@/components/sidebar/AuditLogSidebarPanel';
import { OperationsSidebarPanel } from '@/components/sidebar/OperationsSidebarPanel';
import { PhotoLibrarySidebarPanel } from '@/components/photos/PhotoLibrarySidebarPanel';
import { useAuth } from '@/contexts/AuthContext';
import { getSidebarRouteKey } from '@/lib/sidebar-navigation';
import { getSidebarTitle } from '@/lib/sidebar-titles';
import { DashboardOrdersContextPanel } from '@/components/sidebar/DashboardOrdersContextPanel';
import { AdminContextPanel } from '@/components/sidebar/AdminContextPanel';

/**
 * Route-key dispatcher rendered inside the master-nav as the per-page context
 * panel. Each route maps to its own sidebar panel; the two complex routes
 * (dashboard orders, admin) live in their own components.
 */
export function SidebarContextPanel({ onBackToAppNav }: { onBackToAppNav?: () => void } = {}) {
  const pathname = usePathname();
  const { user } = useAuth();
  const routeKey = getSidebarRouteKey(pathname);

  if (routeKey === 'dashboard') return <DashboardOrdersContextPanel />;
  if (routeKey === 'admin') return <AdminContextPanel />;

  if (routeKey === 'operations') return <OperationsSidebarPanel />;
  if (routeKey === 'studio') return <StudioSidebarPanel />;
  if (routeKey === 'support') return <SupportSidebarPanel />;
  if (routeKey === 'ai-chat') return <AiChatSidebarPanel />;
  if (routeKey === 'settings') return <SettingsSidebar />;
  if (routeKey === 'audit-log') return <AuditLogSidebarPanel />;
  if (routeKey === 'receiving') return <ReceivingSidebarPanel />;
  if (routeKey === 'fba') return <FbaSidebarPanel />;
  // /inventory's main shell owns its own header search + filter chips; the
  // panel here carries the section toggle (Inventory ↔ Replenish) plus the
  // tabbed inventory / replenish sidebars.
  if (routeKey === 'inventory') return <InventorySidebarPanel />;
  if (routeKey === 'sourcing') return <SourcingSidebarPanel />;
  if (routeKey === 'products') return <ProductsSidebarPanel />;
  if (routeKey === 'warehouse') return <WarehouseSidebarPanel />;
  if (routeKey === 'walk-in') return <WalkInSidebarPanel embedded hideSectionHeader />;
  if (routeKey === 'repair') return <WalkInSidebarPanel embedded hideSectionHeader />;
  if (routeKey === 'manuals-library') return <ManualsLibrarySidebar />;

  if (routeKey === 'tech') {
    // Identity from the verified session cookie. Proxy guarantees user.
    const techId = String(user?.staffId ?? 0);
    return (
      <TechSidebarPanel
        techId={techId}
        onBackToAppNav={onBackToAppNav}
        contextNavTitle={getSidebarTitle(pathname)}
      />
    );
  }

  if (routeKey === 'ops-photos') return <PhotoLibrarySidebarPanel />;
  if (routeKey === 'packer') return <PackerSidebarPanel />;
  if (routeKey === 'outbound') return <OutboundSidebarPanel />;

  return null;
}
