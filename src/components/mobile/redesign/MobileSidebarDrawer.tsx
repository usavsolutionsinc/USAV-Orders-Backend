'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  History,
  Barcode,
  ShoppingCart,
  PackageOpen,
  Box,
  ClipboardList,
  Lock,
  Wrench,
  MapPin,
  ChevronDown,
  X,
} from '@/components/Icons';
import { TOKENS } from './DesignSystem';
import { IconButton } from '@/design-system/primitives';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

/**
 * Left slide-over navigation drawer for the mobile shell (2026 redesign).
 *
 * Replaces the fixed bottom nav (RedesignedBottomNav): every destination that
 * used to live in the thumb-zone bar now lives here, opened by the top-left menu
 * button in {@link MobileTopBar}. Moving navigation off the bottom edge stops the
 * accidental taps that plagued the bar and frees the very bottom of each page for
 * the page's own contextual content/actions.
 *
 * Structure mirrors the contextual-display "workbench picker" idea on a phone:
 *   Recent · Picks · Scan · Receiving ▸ (Unboxing / Local Pickup / Repair) · Packing
 * with Sign out pinned to the very bottom (a deliberate, low-frequency action kept
 * away from the primary nav so it can't be fat-fingered).
 *
 * The "Receiving" item is a drill-down group: tapping it expands the three modes
 * that have dedicated phone support for capturing/updating photos.
 */

type LeafItem = {
  kind: 'leaf';
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
};

type GroupItem = {
  kind: 'group';
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Any of these path prefixes marks the group (and its row) active. */
  matchPrefixes: string[];
  children: LeafItem[];
};

type NavItem = LeafItem | GroupItem;

// Single source of truth for the drawer's destinations. Scan is pinned to the
// very top (the headline action). Receiving is a drill-down group into its
// photo-capable modes. Icons mirror the desktop nav: Receiving = ClipboardList,
// Packing = Box.
const NAV_ITEMS: NavItem[] = [
  { kind: 'leaf', id: 'scan', label: 'Scan', icon: Barcode, href: '/m/scan' },
  { kind: 'leaf', id: 'home', label: 'Recent', icon: History, href: '/m/home' },
  { kind: 'leaf', id: 'picks', label: 'Picks', icon: ShoppingCart, href: '/m/pick' },
  {
    kind: 'group',
    id: 'receiving',
    label: 'Receiving',
    icon: ClipboardList,
    matchPrefixes: ['/m/receiving', '/m/receive', '/m/r/'],
    children: [
      { kind: 'leaf', id: 'unboxing', label: 'Unboxing', icon: PackageOpen, href: '/m/receiving' },
      { kind: 'leaf', id: 'local-pickup', label: 'Local Pickup', icon: MapPin, href: '/m/receiving?mode=local-pickup' },
      { kind: 'leaf', id: 'repair', label: 'Repair Service', icon: Wrench, href: '/m/receiving?mode=repair' },
    ],
  },
  { kind: 'leaf', id: 'packing', label: 'Packing', icon: Box, href: '/m/pack' },
];

const isLeafActive = (pathname: string | null, href: string) => {
  if (!pathname) return false;
  const base = href.split('?')[0];
  if (base === '/m/home') return pathname === base;
  // Top-level (mode-less) leaves: exact match, plus prefix-match for nested
  // detail routes. Receiving sub-modes use isChildActive (query-aware) instead.
  return pathname === base || pathname.startsWith(`${base}/`);
};

const isGroupActive = (pathname: string | null, prefixes: string[]) =>
  !!pathname && prefixes.some((p) => pathname === p || pathname.startsWith(p));

/** The `?mode=` a child href encodes (null for the bare Unboxing path). */
const hrefMode = (href: string): string | null => {
  const q = href.split('?')[1];
  return q ? new URLSearchParams(q).get('mode') : null;
};

/**
 * A receiving sub-mode child is active only when BOTH its base path AND its
 * `?mode=` match the current location — so on /m/receiving (no mode) ONLY
 * "Unboxing" lights up, not Local Pickup / Repair (which share the base path).
 * This is the fix for all three rows appearing selected at once.
 */
const isChildActive = (pathname: string | null, currentMode: string | null, href: string) => {
  if (!pathname) return false;
  const base = href.split('?')[0];
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return false;
  return hrefMode(href) === currentMode;
};

export const MobileSidebarDrawer = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentMode = searchParams?.get('mode') ?? null;
  const { user, signOut } = useAuth();

  // Auto-expand the Receiving group when the user is somewhere inside it.
  const receivingActive = isGroupActive(pathname, ['/m/receiving', '/m/receive', '/m/r/']);
  const [expanded, setExpanded] = useState<string | null>(receivingActive ? 'receiving' : null);

  // Close on route change so a tap that navigates also dismisses the drawer.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Re-sync the open group whenever the drawer is re-opened on a receiving route.
  useEffect(() => {
    if (open && receivingActive) setExpanded('receiving');
  }, [open, receivingActive]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const navigate = (href: string) => {
    router.push(href);
    onClose();
  };

  const handleSignOut = async () => {
    onClose();
    try {
      await signOut();
      toast.success('Signed out');
    } catch {
      router.replace('/signin');
    }
  };

  return (
    <AnimatePresence>
      {open && user && (
        <>
          {/* Scrim */}
          {/* ds-raw-button: full-bleed animated dismiss scrim (motion.button), not a DS action control */}
          <motion.button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-panelBackdrop bg-slate-900/40 backdrop-blur-[2px]"
          />

          {/* Panel */}
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34, mass: 0.9 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.4, right: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.x < -80 || info.velocity.x < -500) onClose();
            }}
            className="fixed inset-y-0 left-0 z-panel flex h-[100dvh] w-[82%] max-w-[320px] flex-col border-r border-slate-200 bg-white shadow-[12px_0_48px_-16px_rgba(15,23,42,0.35)]"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
              <span className="text-caption font-black uppercase tracking-[0.2em] text-blue-400">
                Menu
              </span>
              <IconButton
                icon={<X className="h-5 w-5" />}
                onClick={onClose}
                ariaLabel="Close menu"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-all active:scale-90"
              />
            </div>

            {/* Nav list */}
            <nav className="flex-1 overflow-y-auto overscroll-contain px-2 py-3">
              <ul className="space-y-1">
                {NAV_ITEMS.map((item) => {
                  if (item.kind === 'leaf') {
                    const active = isLeafActive(pathname, item.href);
                    const Icon = item.icon;
                    return (
                      <li key={item.id}>
                        {/* ds-raw-button: text-left nav row (icon + label + active ring/fill), not a standard action button */}
                        <button
                          onClick={() => navigate(item.href)}
                          className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors active:scale-[0.98] ${
                            active
                              ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <Icon className={`h-5 w-5 shrink-0 ${active ? 'text-blue-600' : 'text-slate-400'}`} />
                          <span className="text-[15px] font-bold tracking-tight">{item.label}</span>
                        </button>
                      </li>
                    );
                  }

                  // Group (drill-down accordion)
                  const Icon = item.icon;
                  const isOpen = expanded === item.id;
                  const groupActive = isGroupActive(pathname, item.matchPrefixes);
                  return (
                    <li key={item.id}>
                      {/* ds-raw-button: text-left drill-down group row (icon + label + chevron + active ring/fill), not a standard action button */}
                      <button
                        onClick={() => setExpanded((cur) => (cur === item.id ? null : item.id))}
                        aria-expanded={isOpen}
                        className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors active:scale-[0.98] ${
                          groupActive
                            ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Icon className={`h-5 w-5 shrink-0 ${groupActive ? 'text-blue-600' : 'text-slate-400'}`} />
                        <span className="flex-1 text-[15px] font-bold tracking-tight">{item.label}</span>
                        <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                          <ChevronDown className={`h-4 w-4 ${groupActive ? 'text-blue-400' : 'text-slate-300'}`} />
                        </motion.span>
                      </button>

                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.ul
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                            className="overflow-hidden pl-3"
                          >
                            <div className="ml-2 space-y-1 border-l border-slate-100 pl-2 pt-1">
                              {item.children.map((child) => {
                                const ChildIcon = child.icon;
                                const childActive = isChildActive(pathname, currentMode, child.href);
                                return (
                                  <li key={child.id}>
                                    {/* ds-raw-button: text-left sub-mode nav row (icon + label + active fill), not a standard action button */}
                                    <button
                                      onClick={() => navigate(child.href)}
                                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors active:scale-[0.98] ${
                                        childActive
                                          ? 'bg-blue-50 text-blue-700'
                                          : 'text-slate-500 hover:bg-slate-50'
                                      }`}
                                    >
                                      <ChildIcon className={`h-4 w-4 shrink-0 ${childActive ? 'text-blue-600' : 'text-slate-400'}`} />
                                      <span className="text-[13.5px] font-semibold">{child.label}</span>
                                    </button>
                                  </li>
                                );
                              })}
                            </div>
                          </motion.ul>
                        )}
                      </AnimatePresence>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* Footer — low-frequency actions pinned to the very bottom, away from
                the primary nav so they can't be accidentally pressed. */}
            <div className="shrink-0 border-t border-slate-100 px-2 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
              {/* ds-raw-button: text-left full-width sign-out row (icon + label), not a standard action button */}
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-slate-500 transition-colors hover:bg-rose-50 active:scale-[0.98]"
              >
                <Lock className="h-5 w-5 shrink-0 text-slate-400" />
                <span className="text-[15px] font-bold tracking-tight">Sign out</span>
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
};
