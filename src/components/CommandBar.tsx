'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, usePathname } from 'next/navigation';
import { framerTransition, framerPresence } from '@/design-system/foundations/motion-framer';
import { sectionLabel, dataValue, microBadge } from '@/design-system/tokens/typography/presets';
import {
  Search,
  X,
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
} from '@/components/Icons';
import { APP_SIDEBAR_NAV, type SidebarNavItem } from '@/lib/sidebar-navigation';

// ── Types ────────────────────────────────────────────────────

interface CommandItem {
  id: string;
  type: 'navigate' | 'search-result' | 'action' | 'recent';
  label: string;
  subtitle?: string;
  href?: string;
  icon: (props: { className?: string }) => JSX.Element;
  onSelect?: () => void;
  entityType?: string;
}

interface SearchResult {
  id: number;
  entityType: string;
  title: string;
  subtitle: string;
  href: string;
}

// ── Constants ────────────────────────────────────────────────

const RECENT_KEY = 'command-bar-recent';
const MAX_RECENT = 8;

const ENTITY_ICONS: Record<string, (props: { className?: string }) => JSX.Element> = {
  order: LayoutDashboard,
  repair: Tool,
  fba: Package,
  receiving: ClipboardList,
  sku: Box,
};

const NAV_ICON_MAP: Record<string, (props: { className?: string }) => JSX.Element> = {
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

// ── Helpers ──────────────────────────────────────────────────

function getRecent(): CommandItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CommandItem[];
  } catch {
    return [];
  }
}

function saveRecent(item: CommandItem) {
  try {
    const existing = getRecent().filter((r) => r.id !== item.id);
    const updated = [{ ...item, type: 'recent' as const }, ...existing].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  } catch {
    // noop
  }
}

function buildNavItems(): CommandItem[] {
  return APP_SIDEBAR_NAV.map((nav: SidebarNavItem) => ({
    id: `nav:${nav.id}`,
    type: 'navigate' as const,
    label: nav.label,
    subtitle: nav.href,
    href: nav.href,
    icon: NAV_ICON_MAP[nav.id] || ChevronRight,
  }));
}

// ── Component ────────────────────────────────────────────────

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [mounted, setMounted] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => { setMounted(true); }, []);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
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

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSearchResults([]);
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Close on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Debounced search
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
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setSearching(false);
        }
      }
    }, 250);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Build items list
  const navItems = useMemo(() => buildNavItems(), []);

  const items = useMemo((): CommandItem[] => {
    const trimmed = query.trim().toLowerCase();

    if (trimmed) {
      // Show search results + filtered nav items
      const matchedNav = navItems.filter(
        (item) =>
          item.label.toLowerCase().includes(trimmed) ||
          (item.subtitle || '').toLowerCase().includes(trimmed),
      );

      const resultItems: CommandItem[] = searchResults.map((r) => ({
        id: `result:${r.entityType}:${r.id}`,
        type: 'search-result' as const,
        label: r.title,
        subtitle: r.subtitle,
        href: r.href,
        icon: ENTITY_ICONS[r.entityType] || Search,
        entityType: r.entityType,
      }));

      return [...matchedNav.slice(0, 4), ...resultItems];
    }

    // No query — show recent + all nav items
    const recent = getRecent();
    return [...recent, ...navItems];
  }, [query, navItems, searchResults]);

  // Reset active index when items change
  useEffect(() => {
    setActiveIndex(0);
  }, [items.length]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const selectItem = useCallback(
    (item: CommandItem) => {
      if (item.onSelect) {
        item.onSelect();
      } else if (item.href) {
        router.push(item.href);
      }

      // Save to recents
      saveRecent(item);
      setOpen(false);
    },
    [router],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && items[activeIndex]) {
        e.preventDefault();
        selectItem(items[activeIndex]);
      }
    },
    [items, activeIndex, selectItem],
  );

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Mobile FAB trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden fixed bottom-5 right-5 z-[80] h-12 w-12 rounded-full bg-gray-900 text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        aria-label="Open command bar"
      >
        <Search className="w-5 h-5" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Scrim */}
            <motion.div
              key="command-scrim"
              {...framerPresence.workOrderScrim}
              transition={framerTransition.overlayScrim}
              className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />

            {/* Dialog */}
            <motion.div
              key="command-dialog"
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -8 }}
              transition={framerTransition.dropdownOpen}
              className="fixed inset-x-0 top-0 z-[1001] flex justify-center pt-[12vh] md:pt-[18vh] px-4"
            >
              <div className="w-full max-w-[520px] bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[70vh]">
                {/* Search input */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                  {searching ? (
                    <Loader2 className="h-4 w-4 text-gray-400 animate-spin flex-shrink-0" />
                  ) : (
                    <Search className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  )}
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search or jump to..."
                    className="flex-1 text-[15px] font-medium text-gray-900 placeholder:text-gray-400 bg-transparent outline-none"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  <kbd className={`hidden md:inline-flex ${microBadge} text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200`}>
                    ESC
                  </kbd>
                </div>

                {/* Results list */}
                <div ref={listRef} className="overflow-y-auto py-2 flex-1" role="listbox">
                  {items.length === 0 && query.trim() && !searching && (
                    <div className="px-4 py-8 text-center text-[13px] text-gray-500">
                      No results for &ldquo;{query}&rdquo;
                    </div>
                  )}

                  {items.map((item, index) => {
                    const isActive = index === activeIndex;
                    const isRecent = item.type === 'recent';
                    const isResult = item.type === 'search-result';

                    // Section headers
                    const prevType = items[index - 1]?.type;
                    const showSectionHeader =
                      (index === 0 && isRecent) ||
                      (isRecent && prevType !== 'recent') ||
                      (item.type === 'navigate' && prevType !== 'navigate' && !query.trim()) ||
                      (isResult && prevType !== 'search-result');

                    return (
                      <div key={item.id}>
                        {showSectionHeader && (
                          <div className="px-4 pt-3 pb-1">
                            <span className={sectionLabel}>
                              {isRecent ? 'Recent' : isResult ? 'Search Results' : 'Pages'}
                            </span>
                          </div>
                        )}
                        <button
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onClick={() => selectItem(item)}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            isActive ? 'bg-gray-100' : 'bg-transparent hover:bg-gray-50'
                          }`}
                        >
                          <item.icon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className={`truncate ${dataValue}`}>
                              {item.label}
                            </div>
                            {item.subtitle && (
                              <div className="text-[11px] font-semibold text-gray-500 truncate">
                                {item.subtitle}
                              </div>
                            )}
                          </div>
                          {isResult && item.entityType && (
                            <span className={`${microBadge} text-gray-500 flex-shrink-0`}>
                              {item.entityType}
                            </span>
                          )}
                          {isActive && (
                            <ChevronRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 bg-gray-50/60">
                  <div className="flex items-center gap-3 text-[10px] font-bold text-gray-500">
                    <span className="flex items-center gap-1">
                      <kbd className="font-mono font-bold bg-gray-100 px-1 py-0.5 rounded border border-gray-200">↑↓</kbd>
                      navigate
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="font-mono font-bold bg-gray-100 px-1 py-0.5 rounded border border-gray-200">↵</kbd>
                      select
                    </span>
                  </div>
                  <span className="hidden md:flex items-center gap-1 text-[10px] font-bold text-gray-500">
                    <kbd className="font-mono font-bold bg-gray-100 px-1 py-0.5 rounded border border-gray-200">⌘K</kbd>
                    toggle
                  </span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
