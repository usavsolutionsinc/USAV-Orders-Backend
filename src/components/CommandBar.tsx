'use client';

/**
 * CommandBar — global ⌘K / Ctrl+K command menu.
 *
 * Built on the `cmdk` primitive (same library used by Linear, Vercel,
 * Raycast-style menus, shadcn/ui's CommandDialog). cmdk handles a11y,
 * roving focus, arrow-key navigation, and group rendering; this component
 * provides the visual shell (framer-motion modal + backdrop blur),
 * server-side fuzzy search via /api/global-search, recents in localStorage,
 * and an "Ask AI" affordance that deep-links into /ai-chat with the query.
 *
 * `shouldFilter={false}` because we mix two filtering sources:
 *  - static nav items (filtered manually below by query.includes)
 *  - server search results (already filtered server-side)
 * Letting cmdk also filter would double-filter and hide valid server hits.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { useRouter, usePathname } from 'next/navigation';
import {
  Search,
  Loader2,
  Clock,
  LayoutDashboard,
  Package,
  Tool,
  PackageCheck,
  ClipboardList,
  Wrench,
  User,
  Box,
  Zap,
  FileText,
  AlertCircle,
  Calendar,
  ShieldCheck,
  ChevronRight,
  MessageSquare,
} from '@/components/Icons';
import { APP_SIDEBAR_NAV, getSidebarNavItems, type SidebarNavItem } from '@/lib/sidebar-navigation';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────

interface RecentItem {
  id: string;
  label: string;
  subtitle?: string;
  href?: string;
  entityType?: string;
}

interface SearchResult {
  id: number;
  entityType: string;
  title: string;
  subtitle: string;
  href: string;
}

type IconComponent = (props: { className?: string }) => JSX.Element;

// ── Constants ─────────────────────────────────────────────────────────────

const RECENT_KEY = 'command-bar-recent';
const MAX_RECENT = 6;

const ENTITY_ICONS: Record<string, IconComponent> = {
  order: LayoutDashboard,
  repair: Tool,
  fba: Package,
  receiving: ClipboardList,
  sku: Box,
};

const NAV_ICON_MAP: Record<string, IconComponent> = {
  dashboard: LayoutDashboard,
  fba: Package,
  repair: Tool,
  'work-orders': PackageCheck,
  receiving: ClipboardList,
  tech: Wrench,
  packer: User,
  'sku-stock': Box,
  ai: Zap,
  manuals: FileText,
  support: AlertCircle,
  'previous-quarters': Calendar,
  admin: ShieldCheck,
};

// ── Helpers ───────────────────────────────────────────────────────────────

function getRecent(): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecent(item: RecentItem): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const existing = getRecent().filter((r) => r.id !== item.id);
    const updated = [item, ...existing].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

interface NavOption {
  id: string;
  label: string;
  href: string;
  icon: IconComponent;
}

function buildNavItems(permissions?: ReadonlySet<string>): NavOption[] {
  const items = permissions ? getSidebarNavItems({ permissions }) : APP_SIDEBAR_NAV;
  return items.map((nav: SidebarNavItem) => ({
    id: nav.id,
    label: nav.label,
    href: nav.href,
    icon: NAV_ICON_MAP[nav.id] || ChevronRight,
  }));
}

// ── Component ─────────────────────────────────────────────────────────────

export function CommandBar() {
  const shouldReduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [recents, setRecents] = useState<RecentItem[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const router = useRouter();
  const pathname = usePathname();
  const { user: authUser, isLoaded: authLoaded } = useAuth();

  useEffect(() => {
    setMounted(true);
    setRecents(getRecent());
  }, []);

  // ── Keyboard shortcut: ⌘K / Ctrl+K ──
  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        const target = e.target as HTMLElement | null;
        // Don't fight typing in editable surfaces.
        const tag = target?.tagName;
        const editable =
          tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
          target?.isContentEditable;
        if (editable && !open) return;
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // External trigger — the QuickAccess FAB popover dispatches this when the
  // user taps the Search button in its header.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('usav-command-bar-open', onOpen);
    return () => window.removeEventListener('usav-command-bar-open', onOpen);
  }, []);

  // Reset state on open / close on route change.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSearchResults([]);
      setRecents(getRecent());
    }
  }, [open]);
  useEffect(() => { setOpen(false); }, [pathname]);

  // Debounced server search.
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(
          `/api/global-search?q=${encodeURIComponent(query.trim())}&limit=12`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        if (!controller.signal.aborted) {
          setSearchResults(data.rows || []);
          setSearching(false);
        }
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') setSearching(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Build nav items (perm-aware) and filter manually by query.
  const authPermissions = useMemo<ReadonlySet<string> | undefined>(() => {
    if (!authLoaded || !authUser) return undefined;
    return new Set(authUser.permissions);
  }, [authLoaded, authUser]);
  const navItems = useMemo(() => buildNavItems(authPermissions), [authPermissions]);
  const filteredNav = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return navItems;
    return navItems.filter((n) =>
      n.label.toLowerCase().includes(q) || n.href.toLowerCase().includes(q),
    );
  }, [navItems, query]);

  // ── Selection handlers ──

  const navigate = useCallback(
    (item: RecentItem) => {
      if (item.href) router.push(item.href);
      setRecents(saveRecent(item));
      setOpen(false);
    },
    [router],
  );

  const handleAskAi = useCallback(() => {
    const q = query.trim();
    const href = q ? `/ai-chat?q=${encodeURIComponent(q)}` : '/ai-chat';
    router.push(href);
    setOpen(false);
  }, [query, router]);

  if (!mounted) return null;

  const showAskAi = query.trim().length >= 2;
  const showSearchGroup = Boolean(query.trim());
  const showRecentGroup = !query.trim() && recents.length > 0;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="cmdk-scrim"
            initial={framerPresence.workOrderScrim.initial}
            animate={framerPresence.workOrderScrim.animate}
            exit={framerPresence.workOrderScrim.exit}
            transition={shouldReduceMotion ? { duration: 0 } : framerTransition.overlayScrim}
            className="fixed inset-0 z-[1000] bg-gray-900/40 backdrop-blur-md"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          {/* Dialog — top-anchored command palette. Slides down from above
              (negative y), unlike the centered workOrderModal which rises from
              below. Kept inline because the direction is distinct. */}
          <motion.div
            key="cmdk-dialog"
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -8 }}
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -8 }}
            transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 360, mass: 0.7 }}
            className="fixed inset-x-0 top-0 z-[1001] flex justify-center px-4 pt-[12vh] md:pt-[16vh]"
          >
            <Command
              label="Command menu"
              shouldFilter={false}
              loop
              className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-gray-900/30 ring-1 ring-black/[0.04] flex flex-col max-h-[70vh]"
            >
              {/* Input row */}
              <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
                {searching ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />
                ) : (
                  <Search className="h-4 w-4 shrink-0 text-gray-400" />
                )}
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search pages, orders, repairs, SKUs…"
                  autoFocus
                  className="flex-1 bg-transparent text-base font-medium text-gray-900 placeholder:text-gray-400 outline-none"
                />
                <kbd className="hidden shrink-0 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-micro font-semibold text-gray-500 md:inline-flex">
                  ESC
                </kbd>
              </div>

              {/* List */}
              <Command.List
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2"
              >
                <Command.Empty className="px-4 py-10 text-center text-sm text-gray-500">
                  {searching ? 'Searching…' : query.trim() ? `No matches for "${query}"` : 'Type to search'}
                </Command.Empty>

                {showRecentGroup && (
                  <Command.Group
                    heading="Recent"
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-gray-400"
                  >
                    {recents.map((r) => {
                      const Icon = r.entityType
                        ? ENTITY_ICONS[r.entityType] || Clock
                        : Clock;
                      return (
                        <CmdRow
                          key={`recent:${r.id}`}
                          value={`recent ${r.label} ${r.href ?? ''}`}
                          icon={<Icon className="h-4 w-4 text-gray-400" />}
                          label={r.label}
                          subLabel={r.subtitle ?? r.href ?? undefined}
                          onSelect={() => navigate(r)}
                        />
                      );
                    })}
                  </Command.Group>
                )}

                {filteredNav.length > 0 && (
                  <Command.Group
                    heading="Pages"
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-gray-400"
                  >
                    {filteredNav.map((n) => {
                      const Icon = n.icon;
                      return (
                        <CmdRow
                          key={`nav:${n.id}`}
                          value={`page ${n.label} ${n.href}`}
                          icon={<Icon className="h-4 w-4 text-gray-400" />}
                          label={n.label}
                          subLabel={n.href}
                          onSelect={() =>
                            navigate({ id: `nav:${n.id}`, label: n.label, href: n.href })
                          }
                        />
                      );
                    })}
                  </Command.Group>
                )}

                {showSearchGroup && searchResults.length > 0 && (
                  <Command.Group
                    heading="Search results"
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-gray-400"
                  >
                    {searchResults.map((r) => {
                      const Icon = ENTITY_ICONS[r.entityType] || Search;
                      return (
                        <CmdRow
                          key={`result:${r.entityType}:${r.id}`}
                          value={`result ${r.entityType} ${r.id} ${r.title}`}
                          icon={<Icon className="h-4 w-4 text-gray-400" />}
                          label={r.title}
                          subLabel={r.subtitle}
                          badge={r.entityType}
                          onSelect={() =>
                            navigate({
                              id: `result:${r.entityType}:${r.id}`,
                              label: r.title,
                              subtitle: r.subtitle,
                              href: r.href,
                              entityType: r.entityType,
                            })
                          }
                        />
                      );
                    })}
                  </Command.Group>
                )}

                {showAskAi && (
                  <Command.Group
                    heading="AI"
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-gray-400"
                  >
                    <CmdRow
                      value={`ai ask ${query}`}
                      icon={
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
                          <MessageSquare className="h-3 w-3" />
                        </span>
                      }
                      label={`Ask AI: "${query}"`}
                      subLabel="Open chat with this question"
                      onSelect={handleAskAi}
                    />
                  </Command.Group>
                )}
              </Command.List>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/70 px-4 py-2 text-micro font-bold text-gray-500">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <kbd className="rounded border border-gray-200 bg-white px-1 py-0.5 font-mono">↑↓</kbd>
                    navigate
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <kbd className="rounded border border-gray-200 bg-white px-1 py-0.5 font-mono">↵</kbd>
                    select
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1">
                    <kbd className="rounded border border-gray-200 bg-white px-1 py-0.5 font-mono">esc</kbd>
                    close
                  </span>
                </div>
                <span className="hidden md:inline-flex items-center gap-1">
                  <kbd className="rounded border border-gray-200 bg-white px-1 py-0.5 font-mono">⌘K</kbd>
                  toggle
                </span>
              </div>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ── Row primitive ─────────────────────────────────────────────────────────

interface CmdRowProps {
  value: string;
  icon: React.ReactNode;
  label: string;
  subLabel?: string;
  badge?: string;
  onSelect: () => void;
}

function CmdRow({ value, icon, label, subLabel, badge, onSelect }: CmdRowProps) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="group mx-1 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-800 transition-colors data-[selected=true]:bg-gray-100 data-[selected=true]:text-gray-900 aria-selected:bg-gray-100"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{label}</span>
        {subLabel && (
          <span className="block truncate text-caption font-medium text-gray-500">{subLabel}</span>
        )}
      </span>
      {badge && (
        <span className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-gray-500 group-data-[selected=true]:bg-white group-data-[selected=true]:text-gray-700">
          {badge}
        </span>
      )}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300 opacity-0 transition-opacity group-data-[selected=true]:opacity-100" />
    </Command.Item>
  );
}

export default CommandBar;
