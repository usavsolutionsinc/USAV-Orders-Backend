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
  Packer,
  Box,
  Zap,
  FileText,
  AlertCircle,
  ShieldCheck,
  ChevronRight,
  MessageSquare,
} from '@/components/Icons';
import { APP_SIDEBAR_NAV, getSidebarNavItems, type SidebarNavItem } from '@/lib/sidebar-navigation';
import { looksLikeIdentifier, searchScopeHref, searchScopeLabel } from '@/lib/search/search-hit';
import { isSearchEntityType } from '@/lib/search/build-search-text';
// AI-search rollout flag probe + retrieve POST — shared client bridge
// (src/lib/search/ai-search-client.ts) so CommandBar and the workbench
// quick-jumps stay on one implementation.
import { fetchAiSearchEnabled, postAiRetrieve } from '@/lib/search/ai-search-client';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────

interface RecentItem {
  id: string;
  label: string;
  subtitle?: string;
  href?: string;
  entityType?: string;
}

interface SearchResultChip {
  label: string;
  tone?: string;
}

interface SearchResult {
  id: number;
  entityType: string;
  title: string;
  subtitle: string;
  href: string;
  /** Present on AI-retrieve hits only (SearchHit superset fields). */
  score?: number;
  chips?: SearchResultChip[];
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
  unit: PackageCheck,
};

const NAV_ICON_MAP: Record<string, IconComponent> = {
  dashboard: LayoutDashboard,
  fba: Package,
  repair: Tool,
  'work-orders': PackageCheck,
  receiving: ClipboardList,
  tech: Wrench,
  packer: Packer,
  'sku-stock': Box,
  ai: Zap,
  manuals: FileText,
  support: AlertCircle,
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

/**
 * Merge AI-retrieve hits with classic global-search rows, deduped by
 * (entityType, id). AI hits lead (they carry score + facet chips); a
 * duplicated classic row only contributes its subtitle when the AI hit
 * lacks one. Classic-only rows follow in their original order.
 */
function mergeSearchResults(
  aiHits: SearchResult[],
  globalRows: SearchResult[],
  limit: number,
): SearchResult[] {
  const merged: SearchResult[] = [];
  const seen = new Map<string, SearchResult>();
  for (const hit of aiHits) {
    const key = `${hit.entityType}:${hit.id}`;
    if (seen.has(key)) continue;
    seen.set(key, hit);
    merged.push(hit);
  }
  for (const row of globalRows) {
    const key = `${row.entityType}:${row.id}`;
    const existing = seen.get(key);
    if (existing) {
      if (!existing.subtitle && row.subtitle) existing.subtitle = row.subtitle;
      continue;
    }
    seen.set(key, row);
    merged.push(row);
  }
  return merged.slice(0, limit);
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
  const [aiEnabled, setAiEnabled] = useState(false);
  // Phase 2b: inline Ask-AI results (mode:'ask' — one forced LLM tool call
  // distills the question, same hybrid engine returns the hits). `forQuery`
  // pins results to the question they answered; typing resets to idle.
  const [askAi, setAskAi] = useState<{
    status: 'idle' | 'loading' | 'done';
    hits: SearchResult[];
    forQuery: string;
    /** LLM-distilled scope from mode:'ask' — drives the "View all in …" action. */
    toolArgs?: { query: string; entityTypes?: string[] };
  }>({ status: 'idle', hits: [], forQuery: '' });

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

  // Reset state on open / close on route change. Opening also resolves the
  // AI-search rollout flag (memoized per session — one probe, ever).
  useEffect(() => {
    if (open) {
      setQuery('');
      setSearchResults([]);
      setAskAi({ status: 'idle', hits: [], forQuery: '' });
      setRecents(getRecent());
      fetchAiSearchEnabled().then(setAiEnabled);
    }
  }, [open]);
  useEffect(() => { setOpen(false); }, [pathname]);

  // Debounced server search. Flag off → the classic global-search fetch,
  // unchanged. Flag on → global-search AND /api/ai/retrieve race in parallel
  // under one AbortController; hits merge deduped by (entityType, id). Either
  // source failing degrades to the other — never a broken palette.
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
      const q = query.trim();
      try {
        // Classic-only path: flag off, or sub-2-char input (too short for the
        // hybrid pipeline to add value over a cached ILIKE pass).
        if (!aiEnabled || q.length < 2) {
          const res = await fetch(
            `/api/global-search?q=${encodeURIComponent(q)}&limit=12`,
            { signal: controller.signal },
          );
          if (!res.ok) throw new Error('Search failed');
          const data = await res.json();
          if (!controller.signal.aborted) {
            setSearchResults(data.rows || []);
            setSearching(false);
          }
          return;
        }

        const fetchGlobal = () =>
          fetch(`/api/global-search?q=${encodeURIComponent(q)}&limit=12`, {
            signal: controller.signal,
          })
            .then((res) => (res.ok ? res.json() : { rows: [] }))
            .catch((err) => {
              if ((err as { name?: string }).name === 'AbortError') throw err;
              return { rows: [] };
            });

        // pageContext = the surface ⌘K was opened from; the server
        // soft-boosts that surface's entity types (never filters).
        const fetchRetrieve = () =>
          postAiRetrieve(q, { limit: 12, pageContext: pathname, signal: controller.signal });

        // Identifier-shaped queries: retrieve's exact bypass runs the SAME
        // parent-table searchers as global-search, so firing both would run
        // the 5-table fan-out twice per keystroke. Retrieve only; fall back
        // to global-search when retrieve itself errors.
        if (looksLikeIdentifier(q)) {
          const aiData = await fetchRetrieve();
          let rows: SearchResult[] = [];
          if (!aiData) {
            const globalData = await fetchGlobal();
            rows = globalData.rows || [];
          }
          if (!controller.signal.aborted) {
            setSearchResults(mergeSearchResults(aiData?.hits || [], rows, 12));
            setSearching(false);
          }
          return;
        }

        const [globalData, aiData] = await Promise.all([fetchGlobal(), fetchRetrieve()]);
        if (!controller.signal.aborted) {
          setSearchResults(mergeSearchResults(aiData?.hits || [], globalData.rows || [], 12));
          setSearching(false);
        }
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') setSearching(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, aiEnabled, pathname]);

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

  const openAiChat = useCallback(() => {
    const q = query.trim();
    const href = q ? `/ai-chat?q=${encodeURIComponent(q)}` : '/ai-chat';
    router.push(href);
    setOpen(false);
  }, [query, router]);

  // Flag on → run Ask-AI inline (audited + rate-limited server-side) and
  // render the hits in place; any failure falls back to the classic chat
  // deep-link. Flag off → the pre-AI behavior, unchanged.
  const handleAskAi = useCallback(async () => {
    if (!aiEnabled) {
      openAiChat();
      return;
    }
    const q = query.trim();
    if (!q) {
      openAiChat();
      return;
    }
    setAskAi({ status: 'loading', hits: [], forQuery: q });
    const data = await postAiRetrieve(q, { mode: 'ask', limit: 8, pageContext: pathname });
    if (data) {
      // Staleness guard: commit only if this response still answers the
      // question we're loading — typing resets to idle, and a slow response
      // for an old question must not resurrect over it (or over a newer ask).
      setAskAi((prev) =>
        prev.status === 'loading' && prev.forQuery === q
          ? { status: 'done', hits: data.hits || [], forQuery: q, toolArgs: data.toolArgs }
          : prev,
      );
    } else {
      let wasCurrent = false;
      setAskAi((prev) => {
        if (prev.status === 'loading' && prev.forQuery === q) {
          wasCurrent = true;
          return { status: 'idle', hits: [], forQuery: '' };
        }
        return prev;
      });
      if (wasCurrent) openAiChat();
    }
  }, [aiEnabled, query, pathname, openAiChat]);

  // §8.4 "AI-suggested filter application": when the LLM scoped the question
  // to one entity type that has a URL-searchable list surface, offer to open
  // that surface with the distilled query applied as its own filter.
  const askAiScopeAction = useMemo(() => {
    if (askAi.status !== 'done' || !askAi.toolArgs) return null;
    const types = (askAi.toolArgs.entityTypes ?? []).filter(isSearchEntityType);
    if (types.length !== 1) return null;
    const href = searchScopeHref(types[0], askAi.toolArgs.query);
    const label = searchScopeLabel(types[0]);
    if (!href || !label) return null;
    return { href, label, query: askAi.toolArgs.query };
  }, [askAi]);

  // Typing a new question invalidates the previous inline answer.
  useEffect(() => {
    setAskAi((prev) =>
      prev.status === 'idle' || prev.forQuery === query.trim()
        ? prev
        : { status: 'idle', hits: [], forQuery: '' },
    );
  }, [query]);

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
            className="fixed inset-0 z-command bg-gray-900/40 backdrop-blur-md"
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
            className="fixed inset-x-0 top-0 z-command flex justify-center px-4 pt-[12vh] md:pt-[16vh]"
            // Click-off to dismiss: the dialog container overlaps the backdrop
            // (empty space above / beside the palette), so a click that lands on
            // the container itself — not on the Command palette inside it —
            // closes the menu, matching the backdrop's behavior.
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <Command
              label="Command menu"
              shouldFilter={false}
              loop
              className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-border-soft bg-surface-card shadow-2xl shadow-gray-900/30 ring-1 ring-black/[0.04] flex flex-col max-h-[70vh]"
            >
              {/* Input row */}
              <div className="flex items-center gap-3 border-b border-border-hairline px-4 py-3">
                {searching ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-faint" />
                ) : (
                  <Search className="h-4 w-4 shrink-0 text-text-faint" />
                )}
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search pages, orders, repairs, SKUs…"
                  autoFocus
                  className="flex-1 bg-transparent text-base font-medium text-text-default placeholder:text-text-faint outline-none"
                />
                <kbd className="hidden shrink-0 rounded-md border border-border-soft bg-surface-canvas px-1.5 py-0.5 font-mono text-micro font-semibold text-text-soft md:inline-flex">
                  ESC
                </kbd>
              </div>

              {/* List */}
              <Command.List
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2"
              >
                <Command.Empty className="px-4 py-10 text-center text-sm text-text-soft">
                  {searching ? 'Searching…' : query.trim() ? `No matches for "${query}"` : 'Type to search'}
                </Command.Empty>

                {showRecentGroup && (
                  <Command.Group
                    heading="Recent"
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-text-faint"
                  >
                    {recents.map((r) => {
                      const Icon = r.entityType
                        ? ENTITY_ICONS[r.entityType] || Clock
                        : Clock;
                      return (
                        <CmdRow
                          key={`recent:${r.id}`}
                          value={`recent ${r.label} ${r.href ?? ''}`}
                          icon={<Icon className="h-4 w-4 text-text-faint" />}
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
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-text-faint"
                  >
                    {filteredNav.map((n) => {
                      const Icon = n.icon;
                      return (
                        <CmdRow
                          key={`nav:${n.id}`}
                          value={`page ${n.label} ${n.href}`}
                          icon={<Icon className="h-4 w-4 text-text-faint" />}
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
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-text-faint"
                  >
                    <CmdRow
                      value={`search all results ${query}`}
                      icon={<Search className="h-4 w-4 text-text-faint" />}
                      label={`See all results for "${query.trim()}"`}
                      subLabel="Open the full search page with categories"
                      onSelect={() =>
                        navigate({
                          id: `search-all:${query.trim()}`,
                          label: `Search: ${query.trim()}`,
                          href: `/search?q=${encodeURIComponent(query.trim())}`,
                        })
                      }
                    />
                    {searchResults.map((r) => {
                      const Icon = ENTITY_ICONS[r.entityType] || Search;
                      return (
                        <CmdRow
                          key={`result:${r.entityType}:${r.id}`}
                          value={`result ${r.entityType} ${r.id} ${r.title}`}
                          icon={<Icon className="h-4 w-4 text-text-faint" />}
                          label={r.title}
                          subLabel={r.subtitle}
                          badge={r.entityType}
                          chips={r.chips}
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
                    heading={askAi.status === 'done' ? 'AI results' : 'AI'}
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-text-faint"
                  >
                    {askAi.status === 'loading' && (
                      <CmdRow
                        value="ai asking"
                        icon={<Loader2 className="h-4 w-4 animate-spin text-text-faint" />}
                        label="Asking AI…"
                        subLabel={`Searching for "${askAi.forQuery}"`}
                        onSelect={() => {}}
                      />
                    )}
                    {askAi.status === 'done' &&
                      askAi.hits.map((r) => {
                        const Icon = ENTITY_ICONS[r.entityType] || Search;
                        return (
                          <CmdRow
                            key={`ai:${r.entityType}:${r.id}`}
                            value={`ai result ${r.entityType} ${r.id} ${r.title}`}
                            icon={<Icon className="h-4 w-4 text-text-faint" />}
                            label={r.title}
                            subLabel={r.subtitle}
                            badge={r.entityType}
                            chips={r.chips}
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
                    {askAi.status === 'done' && askAi.hits.length === 0 && (
                      <CmdRow
                        value="ai no matches"
                        icon={<Search className="h-4 w-4 text-text-faint" />}
                        label="No AI matches"
                        subLabel="Open chat to dig deeper"
                        onSelect={openAiChat}
                      />
                    )}
                    {askAiScopeAction && (
                      <CmdRow
                        value={`ai scope ${askAiScopeAction.label}`}
                        icon={<Search className="h-4 w-4 text-text-faint" />}
                        label={`View all in ${askAiScopeAction.label}`}
                        subLabel={`Apply "${askAiScopeAction.query}" as the list filter`}
                        onSelect={() =>
                          navigate({
                            id: `ai-scope:${askAiScopeAction.href}`,
                            label: `${askAiScopeAction.label}: ${askAiScopeAction.query}`,
                            href: askAiScopeAction.href,
                          })
                        }
                      />
                    )}
                    {askAi.status !== 'loading' && (
                      <CmdRow
                        value={`ai ask ${query}`}
                        icon={
                          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
                            <MessageSquare className="h-3 w-3" />
                          </span>
                        }
                        label={
                          askAi.status === 'done'
                            ? 'Open in AI chat'
                            : `Ask AI: "${query}"`
                        }
                        subLabel={
                          askAi.status === 'done'
                            ? 'Continue this question in chat'
                            : aiEnabled
                              ? 'Search with AI — results appear here'
                              : 'Open chat with this question'
                        }
                        onSelect={askAi.status === 'done' ? openAiChat : handleAskAi}
                      />
                    )}
                  </Command.Group>
                )}
              </Command.List>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 border-t border-border-hairline bg-surface-canvas/70 px-4 py-2 text-micro font-bold text-text-soft">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <kbd className="rounded border border-border-soft bg-surface-card px-1 py-0.5 font-mono">↑↓</kbd>
                    navigate
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <kbd className="rounded border border-border-soft bg-surface-card px-1 py-0.5 font-mono">↵</kbd>
                    select
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1">
                    <kbd className="rounded border border-border-soft bg-surface-card px-1 py-0.5 font-mono">esc</kbd>
                    close
                  </span>
                </div>
                <span className="hidden md:inline-flex items-center gap-1">
                  <kbd className="rounded border border-border-soft bg-surface-card px-1 py-0.5 font-mono">⌘K</kbd>
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
  /** Facet chips from AI-retrieve SearchHits (status / condition / platform). */
  chips?: SearchResultChip[];
  onSelect: () => void;
}

// House 3-layer chip tones (bg-x-50 / text-x-700 / ring-x-200) — the same
// families every triage chip uses; tone keys come from SearchHitChip.
const CHIP_TONE_CLASSES: Record<string, string> = {
  gray: 'bg-surface-canvas text-text-muted ring-border-soft',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
};

function CmdRow({ value, icon, label, subLabel, badge, chips, onSelect }: CmdRowProps) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="group mx-1 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-text-default transition-colors data-[selected=true]:bg-surface-sunken data-[selected=true]:text-text-default aria-selected:bg-surface-sunken"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{label}</span>
        {subLabel && (
          <span className="block truncate text-caption font-medium text-text-soft">{subLabel}</span>
        )}
      </span>
      {chips?.slice(0, 2).map((chip) => (
        <span
          key={chip.label}
          className={`hidden shrink-0 rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset md:inline-flex ${
            CHIP_TONE_CLASSES[chip.tone ?? 'gray'] ?? CHIP_TONE_CLASSES.gray
          }`}
        >
          {chip.label}
        </span>
      ))}
      {badge && (
        <span className="shrink-0 rounded-md bg-surface-sunken px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-text-soft group-data-[selected=true]:bg-surface-card group-data-[selected=true]:text-text-muted">
          {badge}
        </span>
      )}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition-opacity group-data-[selected=true]:opacity-100" />
    </Command.Item>
  );
}
