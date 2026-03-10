'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, LayoutDashboard, Menu, X } from '@/components/Icons';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { ADMIN_SECTION_OPTIONS, type AdminSection } from '@/components/admin/admin-sections';
import BarcodeSidebar from '@/components/BarcodeSidebar';
import { QuarterSidebar } from '@/components/QuarterSelector';
import { DashboardManagementPanel } from '@/components/sidebar/DashboardManagementPanel';
import { RepairSidebar } from '@/components/repair';
import ShippedSidebar from '@/components/ShippedSidebar';
import UnshippedSidebar from '@/components/unshipped/UnshippedSidebar';
import { ManualsSidebar } from '@/components/manuals/ManualsSidebar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { TechSidebarPanel } from '@/components/sidebar/TechSidebarPanel';
import { PackerSidebarPanel } from '@/components/sidebar/PackerSidebarPanel';
import { ReceivingSidebarPanel } from '@/components/sidebar/ReceivingSidebarPanel';
import { FbaSidebarPanel } from '@/components/sidebar/FbaSidebarPanel';
import { SupportSidebarPanel } from '@/components/sidebar/SupportSidebarPanel';
import {
  APP_SIDEBAR_NAV,
  getSidebarRouteKey,
  isSidebarNavActive,
  type SidebarNavItem,
} from '@/lib/sidebar-navigation';
import type { ShippedFormData } from '@/components/shipped';
import { dispatchCloseShippedDetails } from '@/utils/events';

type DashboardOrderView = 'pending' | 'unshipped' | 'shipped';

const ORDER_VIEW_OPTIONS: Array<{ value: DashboardOrderView; label: string }> = [
  { value: 'unshipped', label: 'Unshipped Orders' },
  { value: 'pending', label: 'Pending Orders' },
  { value: 'shipped', label: 'Shipped Orders' },
];

function getOrderViewFromSearch(searchParams: { has: (key: string) => boolean }): DashboardOrderView {
  if (searchParams.has('unshipped')) return 'unshipped';
  if (searchParams.has('pending')) return 'pending';
  if (searchParams.has('shipped')) return 'shipped';
  return 'pending';
}

function normalizeOrderViewParams(params: URLSearchParams, preferredView?: DashboardOrderView): DashboardOrderView {
  const nextView = preferredView ?? getOrderViewFromSearch(params);
  params.delete('unshipped');
  params.delete('pending');
  params.delete('shipped');
  params.set(nextView, '');
  return nextView;
}

function getPathStaffId(pathname: string | null, segment: 'tech' | 'packer'): string | null {
  if (!pathname) return null;
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== segment) return null;
  const value = String(parts[1] || '').trim();
  return /^\d+$/.test(value) ? value : null;
}

function getSidebarTitle(pathname: string | null) {
  const routeKey = getSidebarRouteKey(pathname);
  const titles: Record<string, string> = {
    dashboard: 'Dashboard',
    fba: 'FBA',
    receiving: 'Receiving',
    repair: 'Repair',
    'sku-stock': 'Sku Stock',
    tech: 'Technicians',
    packer: 'Packers',
    support: 'Support',
    'previous-quarters': 'Quarters',
    admin: 'Admin',
    manuals: 'Manuals',
  };
  return titles[routeKey] ?? 'Home';
}

function SidebarContextPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeKey = getSidebarRouteKey(pathname);

  const updateSearch = (mutate: (params: URLSearchParams) => void, nextPathname?: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    mutate(nextParams);
    const targetPath = nextPathname || pathname || '/dashboard';
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `${targetPath}?${nextSearch}` : targetPath);
  };

  const closeIntakeForm = () => updateSearch((params) => { params.delete('new'); });

  const submitShippedForm = async (data: ShippedFormData) => {
    try {
      const response =
        data.mode === 'add_order'
          ? await fetch('/api/orders/add', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId: data.order_id,
                productTitle: data.product_title,
                shippingTrackingNumber: data.shipping_tracking_number,
                sku: data.sku || null,
                accountSource: 'Manual',
                condition: data.condition,
              }),
            })
          : await fetch('/api/shipped/submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });

      const result = await response.json();
      if (!result.success) {
        alert(result.error || 'Failed to submit form. Please try again.');
        return;
      }
      closeIntakeForm();
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch {
      alert('Error submitting form. Please try again.');
    }
  };

  if (routeKey === 'dashboard') {
    const orderView = getOrderViewFromSearch(searchParams);
    const filterControl = (
      <ViewDropdown
        options={ORDER_VIEW_OPTIONS}
        value={orderView}
        onChange={(nextView) =>
          updateSearch((params) => {
            normalizeOrderViewParams(params, nextView);
            if (nextView !== 'shipped') params.delete('search');
          }, '/dashboard')
        }
      />
    );

    if (orderView === 'shipped') {
      return (
        <ShippedSidebar
          embedded
          hideSectionHeader
          showIntakeForm={searchParams.get('new') === 'true'}
          onCloseForm={closeIntakeForm}
          onFormSubmit={submitShippedForm}
          filterControl={filterControl}
          showDetailsPanel={false}
        />
      );
    }

    if (orderView === 'unshipped') {
      return (
        <UnshippedSidebar
          embedded
          hideSectionHeader
          showIntakeForm={searchParams.get('new') === 'true'}
          onCloseForm={closeIntakeForm}
          onFormSubmit={submitShippedForm}
          filterControl={filterControl}
        />
      );
    }

    return (
      <DashboardManagementPanel
        showIntakeForm={searchParams.get('new') === 'true'}
        onCloseForm={closeIntakeForm}
        onFormSubmit={submitShippedForm}
        filterControl={filterControl}
        showNextUnassignedButton={orderView === 'pending'}
      />
    );
  }

  if (routeKey === 'admin') {
    const activeSection = (searchParams.get('section') as AdminSection) || 'goals';
    const validSection = ADMIN_SECTION_OPTIONS.some((item) => item.value === activeSection) ? activeSection : 'goals';
    const sidebarSearch = searchParams.get('search') || '';

    return (
      <div className="h-full overflow-hidden">
        <AdminSidebar
          activeSection={validSection}
          onSectionChange={(nextSection) =>
            updateSearch((params) => { params.set('section', nextSection); }, '/admin')
          }
          searchValue={sidebarSearch}
          onSearchChange={(nextValue) =>
            updateSearch((params) => {
              if (nextValue.trim()) params.set('search', nextValue);
              else params.delete('search');
            }, '/admin')
          }
        />
      </div>
    );
  }

  if (routeKey === 'support') return <SupportSidebarPanel />;
  if (routeKey === 'receiving') return <ReceivingSidebarPanel />;
  if (routeKey === 'fba') return <FbaSidebarPanel />;
  if (routeKey === 'sku-stock') return <BarcodeSidebar embedded />;
  if (routeKey === 'repair') return <RepairSidebar embedded hideSectionHeader />;
  if (routeKey === 'previous-quarters') return <QuarterSidebar hideSectionHeader />;
  if (routeKey === 'manuals') return <ManualsSidebar />;

  if (routeKey === 'tech') {
    const techId = searchParams.get('staffId') || getPathStaffId(pathname, 'tech') || '1';
    return <TechSidebarPanel techId={techId} />;
  }

  if (routeKey === 'packer') {
    const packerId = searchParams.get('staffId') || getPathStaffId(pathname, 'packer') || '4';
    return <PackerSidebarPanel packerId={packerId} />;
  }

  return (
    <div className="h-full flex flex-col px-6 py-6">
      <div className="rounded-3xl border border-gray-200 bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-5 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
            <LayoutDashboard className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[18px] font-black uppercase tracking-tight">Workspace</p>
            <p className="text-[9px] font-bold uppercase tracking-[0.35em] text-blue-200">Unified Sidebar</p>
          </div>
        </div>
        <p className="mt-4 text-[11px] font-medium leading-relaxed text-slate-200">
          Navigation and contextual controls now live in one persistent sidebar. Pick a route to load its tools here.
        </p>
      </div>
    </div>
  );
}

function NavSection({
  items,
  pathname,
  resolveHref,
  onNavigate,
}: {
  items: SidebarNavItem[];
  pathname: string | null;
  resolveHref: (item: SidebarNavItem) => string;
  onNavigate: () => void;
}) {
  return (
    <div className="space-y-1">
      {items.map((item) => {
        const href = resolveHref(item);
        const isActive = isSidebarNavActive(pathname, href);
        const Icon = item.icon;
        return (
          <Link
            key={item.id}
            href={href}
            onClick={onNavigate}
            className={`group flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-200 ${
              isActive
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-blue-500'}`} />
            <span className="text-[11px] font-black uppercase tracking-wider">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export default function DashboardSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
  const [showHomeNavigation, setShowHomeNavigation] = useState(false);
  const [lastTechHref, setLastTechHref] = useState('/tech?staffId=1');
  const [lastPackerHref, setLastPackerHref] = useState('/packer?staffId=4');

  useEffect(() => {
    const savedTechHref = localStorage.getItem('last-tech-station-href');
    if (savedTechHref) {
      const legacyId = savedTechHref.match(/^\/tech\/(\d+)$/)?.[1];
      if (legacyId) setLastTechHref(`/tech?staffId=${legacyId}`);
      else if (/^\/tech(\?.*)?$/.test(savedTechHref)) setLastTechHref(savedTechHref);
    }
    const savedPackerHref = localStorage.getItem('last-packer-station-href');
    if (savedPackerHref) {
      const legacyId = savedPackerHref.match(/^\/packer\/(\d+)$/)?.[1];
      if (legacyId) setLastPackerHref(`/packer?staffId=${legacyId}`);
      else if (/^\/packer(\?.*)?$/.test(savedPackerHref)) setLastPackerHref(savedPackerHref);
    }
  }, []);

  useEffect(() => {
    if (!pathname) return;
    if (pathname.startsWith('/tech')) {
      const params = new URLSearchParams(searchParams.toString());
      const pathId = getPathStaffId(pathname, 'tech');
      if (!params.get('staffId') && pathId) params.set('staffId', pathId);
      if (!params.get('staffId')) params.set('staffId', '1');
      const href = `/tech?${params.toString()}`;
      localStorage.setItem('last-tech-station-href', href);
      setLastTechHref(href);
    }
    if (pathname.startsWith('/packer')) {
      const params = new URLSearchParams(searchParams.toString());
      const pathId = getPathStaffId(pathname, 'packer');
      if (!params.get('staffId') && pathId) params.set('staffId', pathId);
      if (!params.get('staffId')) params.set('staffId', '4');
      const href = `/packer?${params.toString()}`;
      localStorage.setItem('last-packer-station-href', href);
      setLastPackerHref(href);
    }
    setShowHomeNavigation(false);
    setIsMobileOpen(false);
    setIsDetailsPanelOpen(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    const handleOpenDetails = () => { setIsDetailsPanelOpen(true); setIsMobileOpen(false); };
    const handleCloseDetails = () => { setIsDetailsPanelOpen(false); };
    window.addEventListener('open-shipped-details' as any, handleOpenDetails as any);
    window.addEventListener('close-shipped-details' as any, handleCloseDetails as any);
    return () => {
      window.removeEventListener('open-shipped-details' as any, handleOpenDetails as any);
      window.removeEventListener('close-shipped-details' as any, handleCloseDetails as any);
    };
  }, []);

  const resolveHref = (item: SidebarNavItem) => {
    if (item.id === 'tech') return lastTechHref;
    if (item.id === 'packer') return lastPackerHref;
    return item.href;
  };

  const routeKey = getSidebarRouteKey(pathname);
  const sidebarTitle = getSidebarTitle(pathname);

  const groupedNav = {
    main: APP_SIDEBAR_NAV.filter((item) => item.kind === 'main'),
    station: APP_SIDEBAR_NAV.filter((item) => item.kind === 'station'),
    bottom: APP_SIDEBAR_NAV.filter((item) => item.kind === 'bottom'),
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, x: -20, filter: 'blur(4px)' },
    visible: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { type: 'spring', damping: 25, stiffness: 350, mass: 0.5 } },
  };

  const homePanel = (
    <motion.div initial="hidden" animate="visible" variants={containerVariants} className="h-full overflow-y-auto bg-white">
      <div className="px-3 py-3 space-y-6">
        <motion.div variants={itemVariants}>
          <p className="px-1 pb-2 text-[9px] font-black uppercase tracking-[0.25em] text-blue-600">Main</p>
          <NavSection items={groupedNav.main} pathname={pathname} resolveHref={resolveHref} onNavigate={() => setShowHomeNavigation(false)} />
        </motion.div>
        <motion.div variants={itemVariants}>
          <p className="px-1 pb-2 text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">Stations</p>
          <NavSection items={groupedNav.station} pathname={pathname} resolveHref={resolveHref} onNavigate={() => setShowHomeNavigation(false)} />
        </motion.div>
        <motion.div variants={itemVariants}>
          <p className="px-1 pb-2 text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">More</p>
          <NavSection items={groupedNav.bottom} pathname={pathname} resolveHref={resolveHref} onNavigate={() => setShowHomeNavigation(false)} />
        </motion.div>
      </div>
    </motion.div>
  );

  const contextPanel = (
    <motion.div initial="hidden" animate="visible" variants={containerVariants} className="h-full flex flex-col overflow-hidden bg-white">
      <motion.button
        variants={itemVariants}
        type="button"
        onClick={() => setShowHomeNavigation(true)}
        className="w-full flex items-center gap-2 pl-1.5 pr-3 pt-1 pb-1 border-b border-gray-100 text-left hover:bg-gray-50 transition-colors"
        aria-label="Back to navigation"
      >
        <div className="h-9 w-7 flex items-center justify-start text-gray-500">
          <ChevronLeft className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-black tracking-tight text-gray-900 truncate">{sidebarTitle}</p>
        </div>
      </motion.button>
      <motion.div variants={itemVariants} className="flex-1 overflow-hidden">
        <SidebarContextPanel />
      </motion.div>
    </motion.div>
  );

  const shell = (
    <aside className="h-full w-full bg-white border-r border-gray-200 overflow-hidden shadow-xl shadow-slate-900/5">
      {showHomeNavigation || routeKey === 'unknown' ? homePanel : contextPanel}
    </aside>
  );

  return (
    <>
      <div
        className={`hidden md:block h-full flex-shrink-0 overflow-hidden transition-[width] duration-300 ${
          isDetailsPanelOpen ? 'w-0' : 'w-[360px]'
        }`}
      >
        {shell}
      </div>

      {isDetailsPanelOpen && (
        <button
          type="button"
          onClick={() => { dispatchCloseShippedDetails(); setIsDetailsPanelOpen(false); }}
          className="hidden md:flex fixed top-4 left-4 z-[90] h-11 w-11 rounded-2xl bg-white border border-gray-200 text-gray-700 shadow-lg shadow-slate-900/10 items-center justify-center"
          aria-label="Open station navigation"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      <button
        type="button"
        onClick={() => setIsMobileOpen(true)}
        className="md:hidden fixed top-4 left-4 z-[90] h-11 w-11 rounded-2xl bg-white border border-gray-200 text-gray-700 shadow-lg shadow-slate-900/10 flex items-center justify-center"
        aria-label="Open sidebar"
      >
        <Menu className="w-5 h-5" />
      </button>

      {isMobileOpen && (
        <div className="md:hidden fixed inset-0 z-[100]">
          <button type="button" className="absolute inset-0 bg-slate-900/35" onClick={() => setIsMobileOpen(false)} aria-label="Close sidebar overlay" />
          <div className="relative h-full max-w-[94vw]">{shell}</div>
          <button
            type="button"
            onClick={() => setIsMobileOpen(false)}
            className="absolute top-4 right-4 h-11 w-11 rounded-2xl bg-white border border-gray-200 text-gray-700 shadow-lg shadow-slate-900/10 flex items-center justify-center"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </>
  );
}
