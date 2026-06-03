'use client';

/**
 * 2026 component showroom — the live, cherry-pick gallery.
 *
 * Every export below is a *working* modernized component rendered in its real
 * states. Nothing here is wired into the app yet: this is the menu. When you
 * pick one, we "promote" it to the path shown in its <Bay> header
 * (e.g. @/design-system/primitives/Button) and start replacing the hand-rolled
 * versions. Built entirely on the stack you already ship: Tailwind + Framer
 * Motion 11 + Sonner + your CSS-variable design tokens.
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, animate } from 'framer-motion';
import { toast } from 'sonner';
import {
  Check,
  Plus,
  Printer,
  Search,
  Trash2,
  Loader2,
  X,
  Package,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  ChevronRight,
  Settings,
  Truck,
  List,
  Box,
  FileText,
  Barcode,
  Link2,
  Clock,
  History,
} from '@/components/Icons';

import { MasterNavView } from '@/components/sidebar/master-nav';
import { TextField } from '@/design-system/primitives';
import { SIDEBAR_PAGE_NAV } from '@/lib/sidebar-navigation';

/* ════════════════════════ shared gallery furniture ════════════════════════ */

export type Density = 'compact' | 'cozy' | 'comfortable';

const spring = { type: 'spring', stiffness: 520, damping: 36 } as const;
const softSpring = { type: 'spring', stiffness: 320, damping: 30 } as const;

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/** Pill marking whether a component is new vs. already in the system. */
function Tag({ kind }: { kind: 'new' | 'have' | 'upgrade' }) {
  const map = {
    new: ['bg-emerald-500/12 text-emerald-600 ring-emerald-500/20', '2026 · New'],
    upgrade: ['bg-violet-500/12 text-violet-600 ring-violet-500/20', '2026 · Upgrade'],
    have: ['bg-slate-500/10 text-text-muted ring-border-soft', 'In system'],
  } as const;
  const [cls, label] = map[kind];
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1', cls)}>
      {label}
    </span>
  );
}

/**
 * One catalog entry: title, "promote to" path, live render surface, optional
 * caption. The dashed promote path is the whole point — it tells you where the
 * component lands the moment you cherry-pick it.
 */
function Bay({
  title,
  promote,
  tag = 'new',
  caption,
  children,
  span = 1,
}: {
  title: string;
  promote: string;
  tag?: 'new' | 'have' | 'upgrade';
  caption?: string;
  children: React.ReactNode;
  span?: 1 | 2;
}) {
  return (
    <div
      className={cx(
        'flex flex-col rounded-2xl border border-border-soft bg-surface-card p-4',
        span === 2 && 'sm:col-span-2',
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold tracking-tight text-text-default">{title}</h3>
          <code className="mt-0.5 block truncate font-mono text-[10px] text-text-muted">{promote}</code>
        </div>
        <Tag kind={tag} />
      </div>
      <div className="flex flex-1 items-center justify-center rounded-xl bg-surface-canvas/60 p-5 ring-1 ring-border-soft/60">
        {children}
      </div>
      {caption ? <p className="mt-2.5 text-[11px] leading-snug text-text-muted">{caption}</p> : null}
    </div>
  );
}

export function SectionHeading({ index, title, blurb }: { index: string; title: string; blurb: string }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-bold text-text-muted">{index}</span>
        <h2 className="text-lg font-bold tracking-tight text-text-default">{title}</h2>
      </div>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-text-muted">{blurb}</p>
    </div>
  );
}

const densityPad: Record<Density, string> = {
  compact: 'py-1.5',
  cozy: 'py-2.5',
  comfortable: 'py-3.5',
};

/* ════════════════════════════ 1 · BUTTONS ═════════════════════════════════ */

function Btn({
  children,
  variant = 'primary',
  loading,
  className,
  icon: Icon,
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'brand' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  className?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const variants = {
    primary: 'bg-blue-600 text-white shadow-sm shadow-blue-600/25 hover:bg-blue-500',
    brand:
      'text-white shadow-sm shadow-navy-900/30 bg-gradient-to-b from-navy-700 to-navy-900 hover:from-navy-600 hover:to-navy-800',
    secondary: 'bg-surface-card text-text-default ring-1 ring-border-soft hover:bg-surface-canvas',
    ghost: 'text-text-muted hover:bg-surface-canvas hover:text-text-default',
    danger: 'bg-rose-600 text-white shadow-sm shadow-rose-600/25 hover:bg-rose-500',
  } as const;
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      transition={spring}
      disabled={loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] font-semibold transition-colors duration-150 disabled:opacity-60',
        variants[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {children}
    </motion.button>
  );
}

export function ButtonsSection() {
  const [loading, setLoading] = useState(false);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Bay
        title="Button — variants"
        promote="@/design-system/primitives/Button"
        tag="upgrade"
        caption="One <Button variant> replaces the ad-hoc <button className> scattered across sidebars. Spring press feedback on every variant."
        span={2}
      >
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <Btn variant="primary" icon={Plus}>Primary</Btn>
          <Btn variant="brand" icon={Sparkles}>Brand</Btn>
          <Btn variant="secondary" icon={Settings}>Secondary</Btn>
          <Btn variant="ghost">Ghost</Btn>
          <Btn variant="danger" icon={Trash2}>Danger</Btn>
        </div>
      </Bay>
      <Bay
        title="Button — async state"
        promote="@/design-system/primitives/Button"
        tag="upgrade"
        caption="Built-in loading prop. Click to see the spinner swap — no more manual disable+spinner wiring per form."
      >
        <Btn
          variant="primary"
          icon={Printer}
          loading={loading}
          className="min-w-[140px]"
        >
          <span
            onClick={() => {
              if (loading) return;
              setLoading(true);
              window.setTimeout(() => setLoading(false), 1600);
            }}
          >
            {loading ? 'Printing…' : 'Pass · Print'}
          </span>
        </Btn>
      </Bay>
    </div>
  );
}

/* ════════════════════════ 2 · SEGMENTED TABS ══════════════════════════════ */

/**
 * Master sidebar nav as a single dropdown component.
 *
 * Instead of rendering a whole different panel per route, the header IS the
 * navigation: tap the page title to drop a menu that switches page AND jumps
 * straight to any of that page's modes. The menu:
 *   • Hides the page you're already on (no point selecting it again).
 *   • Pins a RECENT section on top for fast back-and-forth; recents still
 *     appear in their normal spot in the full ALL PAGES list below.
 *   • Every page is a split row: tap the LEFT (icon + name) to jump straight to
 *     the page's default mode; tap the RIGHT (count + chevron) to expand its
 *     modes as labeled rows — pick one to land on, say, FBA › Inbound.
 * The closed header de-dupes the live rail: the page icon carries the page
 * context, so the header *name* shows the active MODE (not a second "RECEIVING"
 * next to the title).
 */
// Drives the REAL master nav components (<MasterNavView>) against the REAL
// SIDEBAR_PAGE_NAV config — but on local state, so the showroom never actually
// navigates. The live, router-wired version is <MasterNav> in
// @/components/sidebar/master-nav.
function ReceivingModeSwitcherDemo() {
  const pages = SIDEBAR_PAGE_NAV;
  const [pageId, setPageId] = useState('receiving');
  const [modeId, setModeId] = useState<string | null>('receive');
  const [pagesOpen, setPagesOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>(['dashboard', 'fba']);
  // Which page row is expanded to show its mode rows (accordion, one at a time).
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const activePage = pages.find((p) => p.id === pageId) ?? pages[0];
  const activeModeLabel =
    activePage.modes?.find((m) => m.id === modeId)?.label ?? activePage.label;

  // Mirrors <MasterNav>'s onNavigate, minus the router: no mode given → resolve
  // the page's default via its own resolveMode against its bare href; a mode row
  // or L2 pill → that mode.
  const onNavigate = (nextPageId: string, nextModeId?: string) => {
    const target = pages.find((p) => p.id === nextPageId) ?? pages[0];
    const resolved =
      nextModeId ??
      target.resolveMode?.({ pathname: target.href, params: new URLSearchParams() }) ??
      target.modes?.[0]?.id ??
      null;
    setPageId(nextPageId);
    setModeId(resolved);
    // Push to the front of recents (dedup, keep last 3) for fast switch-back.
    setRecents((prev) => [nextPageId, ...prev.filter((id) => id !== nextPageId)].slice(0, 3));
    setExpandedKey(null);
    setPagesOpen(false);
  };

  // Current page hidden from the menu; recents pinned on top (still listed below).
  const recentPages = recents
    .filter((id) => id !== pageId)
    .flatMap((id) => pages.filter((p) => p.id === id));
  const otherPages = pages.filter((p) => p.id !== pageId);

  return (
    <div className="mx-auto w-full max-w-[320px] space-y-3">
      {/* Phone-width rail card. Bottom is squared (rounded-t only) so the grey L2
          mode strip fills flush to the edges instead of reading as a rounded
          bubble. No overflow-hidden, or the dropdown gets clipped. */}
      <div className="relative rounded-t-[1.5rem] border border-border-soft bg-surface-card shadow-sm">
        <MasterNavView
          activePage={activePage}
          activeModeId={modeId}
          open={pagesOpen}
          onToggleOpen={() => setPagesOpen((v) => !v)}
          recentPages={recentPages}
          otherPages={otherPages}
          expandedKey={expandedKey}
          onToggleRow={setExpandedKey}
          onNavigate={onNavigate}
          onRequestClose={() => {
            setPagesOpen(false);
            setExpandedKey(null);
          }}
        />
      </div>

      <p className="text-center text-[11px] leading-relaxed text-text-muted">
        <span className="font-semibold text-text-default">{activePage.label}</span> ›{' '}
        <span className="font-semibold text-text-default">{activeModeLabel}</span>
        <br />
        Title = master nav (recents on top, current hidden) · tap a row's left to go, right (⌄) to pick a mode
      </p>
    </div>
  );
}

export function SegmentedTabsSection() {
  const tabs = ['Pending', 'Shipped', 'Unshipped', 'FBA'];
  const [active, setActive] = useState(tabs[0]);
  const reduce = useReducedMotion();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Bay
        title="Segmented tabs — sliding indicator"
        promote="@/components/ui/TabSwitch (layoutId variant)"
        tag="upgrade"
        caption="Framer layoutId animates the active pill between tabs instead of a hard cut. Drop-in upgrade to the existing TabSwitch hard-rule component."
        span={2}
      >
        <div className="inline-flex items-center gap-1 rounded-2xl bg-surface-canvas p-1 ring-1 ring-border-soft">
          {tabs.map((t) => {
            const on = active === t;
            return (
              <button
                key={t}
                onClick={() => setActive(t)}
                className={cx(
                  'relative rounded-xl px-3.5 py-1.5 text-[12px] font-semibold transition-colors duration-150',
                  on ? 'text-text-default' : 'text-text-muted hover:text-text-default',
                )}
              >
                {on && (
                  <motion.span
                    layoutId="seg-pill"
                    className="absolute inset-0 rounded-xl bg-surface-card shadow-sm ring-1 ring-border-soft"
                    transition={reduce ? { duration: 0 } : spring}
                  />
                )}
                <span className="relative z-10">{t}</span>
              </button>
            );
          })}
        </div>
      </Bay>
      <Bay
        title="Master sidebar nav — one dropdown, page + mode"
        promote="@/components/DashboardSidebar (nav dropdown)"
        tag="upgrade"
        caption="Replaces rendering a whole panel per route with one dropdown. Tap the title: RECENT pages pin on top for fast switch-back, ALL PAGES list below, and the page you're on is hidden. Each page is a split row: tap the left (icon + name) to go straight to the page's default mode; tap the right (count + chevron) to expand its modes as labeled rows and pick one (e.g. FBA › Inbound). The L2 icon row + breadcrumb follow whatever you pick."
        span={2}
      >
        <ReceivingModeSwitcherDemo />
      </Bay>
    </div>
  );
}

/* ═══════════════════ 2b · SUB-PAGE NAVIGATION ═════════════════════════════ */

/**
 * Sub-page navigation patterns — how to expose the sub-pages *inside* one
 * section (e.g. Products → Manuals / Labels / Pairing) on a mobile-first rail.
 *
 * The screenshot that prompted this stacked TWO rows of identical pills
 * (Manuals/Labels/Pairing over Products/Recent/History) with search wedged
 * between. Two identical pill rows read as one ambiguous hierarchy and burn
 * vertical space. These four Bays are the industry-standard alternatives,
 * rendered phone-width so you can judge them the way the operator will. Each
 * differs in weight + how many siblings it scales to — cherry-pick one.
 */
type SubPage = { id: string; label: string; icon: (p: { className?: string }) => JSX.Element };

const SUB_PAGES: SubPage[] = [
  { id: 'products', label: 'Products', icon: Box },
  { id: 'manuals', label: 'Manuals', icon: FileText },
  { id: 'labels', label: 'Labels', icon: Barcode },
  { id: 'pairing', label: 'Pairing', icon: Link2 },
  { id: 'history', label: 'History', icon: History },
];

/** Shared phone-width frame so every variant is judged at real rail width. */
function PhoneFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="mx-auto w-full max-w-[320px] space-y-2">
      <div className="overflow-hidden rounded-[1.4rem] border border-border-soft bg-surface-card shadow-sm">
        <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600/10 text-blue-600">
            <Box className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-bold tracking-tight text-text-default">Products</span>
        </div>
        {children}
      </div>
      <p className="text-center text-[11px] leading-snug text-text-muted">{label}</p>
    </div>
  );
}

/** Inert search bar — every variant scopes search to the active sub-page. */
function MiniSearch() {
  return (
    <div className="relative px-3.5 py-2.5">
      <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
      <div className="w-full rounded-xl border border-border-soft bg-surface-canvas py-2 pl-9 pr-3 text-[13px] text-text-muted">
        Search SKU, title…
      </div>
    </div>
  );
}

/* — Variant A: scrollable underline tab strip — */
function UnderlineStripDemo() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState('manuals');
  return (
    <PhoneFrame label="Scrollable strip, underline indicator · scales to many siblings">
      <div className="-mx-px flex items-center gap-1 overflow-x-auto border-y border-border-soft px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SUB_PAGES.map((p) => {
          const on = active === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setActive(p.id)}
              role="tab"
              aria-selected={on}
              className={cx(
                'relative shrink-0 px-3 py-2.5 text-[13px] font-semibold transition-colors',
                on ? 'text-blue-600' : 'text-text-muted hover:text-text-default',
              )}
            >
              {p.label}
              {on && (
                <motion.span
                  layoutId="subnav-underline"
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue-600"
                  transition={reduce ? { duration: 0 } : spring}
                />
              )}
            </button>
          );
        })}
      </div>
      <MiniSearch />
    </PhoneFrame>
  );
}

/* — Variant B: segmented control (Apple HIG) — */
function SegmentedSubDemo() {
  const reduce = useReducedMotion();
  const segs = SUB_PAGES.slice(0, 3);
  const [active, setActive] = useState('products');
  return (
    <PhoneFrame label="Connected, equal-width · best for a fixed 2–5 set">
      <div className="border-y border-border-soft px-3.5 py-2.5">
        <div className="flex items-center gap-0.5 rounded-xl bg-surface-canvas p-0.5 ring-1 ring-border-soft">
          {segs.map((p) => {
            const on = active === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setActive(p.id)}
                role="tab"
                aria-selected={on}
                className={cx(
                  'relative flex-1 rounded-lg py-1.5 text-[12px] font-semibold transition-colors',
                  on ? 'text-text-default' : 'text-text-muted hover:text-text-default',
                )}
              >
                {on && (
                  <motion.span
                    layoutId="subnav-segment"
                    className="absolute inset-0 rounded-lg bg-surface-card shadow-sm ring-1 ring-border-soft"
                    transition={reduce ? { duration: 0 } : spring}
                  />
                )}
                <span className="relative z-10">{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <MiniSearch />
    </PhoneFrame>
  );
}

/* — Variant C: primary tab strip + secondary chip filter (the two-axis fix) — */
const SUB_FILTERS = [
  { id: 'all', label: 'All', icon: List },
  { id: 'recent', label: 'Recent', icon: Clock },
  { id: 'history', label: 'History', icon: History },
];

function TwoAxisDemo() {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState('manuals');
  const [filter, setFilter] = useState('recent');
  const primary = SUB_PAGES.slice(0, 4);
  return (
    <PhoneFrame label="Bold tab strip = sub-page · quiet chips = filter. Differentiated weight kills the two-row ambiguity">
      {/* primary: which sub-page */}
      <div className="flex items-center gap-1 overflow-x-auto border-y border-border-soft px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {primary.map((p) => {
          const on = tab === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setTab(p.id)}
              role="tab"
              aria-selected={on}
              className={cx(
                'relative shrink-0 px-3 py-2.5 text-[13px] font-semibold transition-colors',
                on ? 'text-blue-600' : 'text-text-muted hover:text-text-default',
              )}
            >
              {p.label}
              {on && (
                <motion.span
                  layoutId="subnav-twoaxis-underline"
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue-600"
                  transition={reduce ? { duration: 0 } : spring}
                />
              )}
            </button>
          );
        })}
      </div>
      <MiniSearch />
      {/* secondary: lighter-weight chip filter */}
      <div className="flex items-center gap-1.5 px-3.5 pb-3">
        {SUB_FILTERS.map((f) => {
          const on = filter === f.id;
          const FIcon = f.icon;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors',
                on
                  ? 'bg-blue-600/10 text-blue-600 ring-blue-600/20'
                  : 'text-text-muted ring-border-soft hover:bg-surface-canvas',
              )}
            >
              <FIcon className="h-3 w-3" />
              {f.label}
            </button>
          );
        })}
      </div>
    </PhoneFrame>
  );
}

/* — Variant D: filled-pill row, single-row scroll (current look, cleaned up) — */
function FilledPillDemo() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState('labels');
  return (
    <PhoneFrame label="Keep the rounded-pill brand look — but never wrap; overflow scrolls">
      <div className="flex items-center gap-2 overflow-x-auto border-y border-border-soft px-3.5 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SUB_PAGES.map((p) => {
          const on = active === p.id;
          const PIcon = p.icon;
          return (
            <button
              key={p.id}
              onClick={() => setActive(p.id)}
              role="tab"
              aria-selected={on}
              className={cx(
                'relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors',
                on ? 'text-white' : 'text-text-muted ring-1 ring-border-soft hover:text-text-default',
              )}
            >
              {on && (
                <motion.span
                  layoutId="subnav-pill"
                  className="absolute inset-0 rounded-full bg-blue-600 shadow-sm shadow-blue-600/25"
                  transition={reduce ? { duration: 0 } : spring}
                />
              )}
              <PIcon className="relative z-10 h-3.5 w-3.5" />
              <span className="relative z-10">{p.label}</span>
            </button>
          );
        })}
      </div>
      <MiniSearch />
    </PhoneFrame>
  );
}

/* — Anti-pattern: two identical pill rows (the screenshot, for contrast) — */
function TwoRowAntiPattern() {
  return (
    <div className="mx-auto w-full max-w-[320px] space-y-2">
      <div className="overflow-hidden rounded-[1.4rem] border border-rose-300/60 bg-surface-card shadow-sm">
        <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600/10 text-blue-600">
            <Box className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-bold tracking-tight text-text-default">Products</span>
        </div>
        {/* row 1 */}
        <div className="flex items-center gap-2 overflow-x-auto px-3.5 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {['Manuals', 'Labels', 'Pairing'].map((t, i) => (
            <span
              key={t}
              className={cx(
                'inline-flex shrink-0 items-center rounded-full px-3.5 py-1.5 text-[12px] font-semibold',
                i === 1 ? 'bg-blue-600 text-white' : 'text-text-muted ring-1 ring-border-soft',
              )}
            >
              {t}
            </span>
          ))}
        </div>
        <MiniSearch />
        {/* row 2 — identical weight = which one is the page? */}
        <div className="flex items-center gap-2 overflow-x-auto px-3.5 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {['Products', 'Recent', 'History'].map((t, i) => (
            <span
              key={t}
              className={cx(
                'inline-flex shrink-0 items-center rounded-full px-3.5 py-1.5 text-[12px] font-semibold',
                i === 0 ? 'bg-blue-600 text-white' : 'text-text-muted ring-1 ring-border-soft',
              )}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
      <p className="text-center text-[11px] font-semibold leading-snug text-rose-600">
        ✗ Anti-pattern · two identical pill rows read as one ambiguous hierarchy
      </p>
    </div>
  );
}

export function SubPageNavSection() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Bay
        title="A · Underline tab strip (safe default)"
        promote="@/design-system/components/SubPageTabs (underline)"
        tag="new"
        caption="One horizontally-scrollable row, underline = “you are here.” The X / App Store / Gmail pattern. Best when you have 4+ peer sub-pages — the subtle indicator reads hierarchy better than loud pills as the count grows."
      >
        <UnderlineStripDemo />
      </Bay>
      <Bay
        title="B · Segmented control (Apple HIG)"
        promote="@/components/ui/TabSwitch (segmented)"
        tag="upgrade"
        caption="Connected, equal-width control. Best for a small, fixed, mutually-exclusive set (2–5). Native-feeling for view switches like Products / Manuals / Labels."
      >
        <SegmentedSubDemo />
      </Bay>
      <Bay
        title="C · Primary tabs + secondary chips (two-axis)"
        promote="@/design-system/components/SubPageTabs (+ FilterChips)"
        tag="new"
        caption="The direct fix for the screenshot. Two independent axes — which sub-page (bold strip) × which dataset (quiet chips) — differentiated by weight instead of stacked as identical rows. My pick for Products."
        span={2}
      >
        <TwoAxisDemo />
      </Bay>
      <Bay
        title="D · Filled-pill row (current look, cleaned)"
        promote="@/components/ui/PillTabs (single-row)"
        tag="upgrade"
        caption="Keeps your rounded-pill aesthetic with a sliding active pill — but a single row that scrolls on overflow instead of wrapping to a second line. Best at ≤5 items."
      >
        <FilledPillDemo />
      </Bay>
      <Bay
        title="✗ Anti-pattern (for contrast)"
        promote="— do not ship —"
        tag="have"
        caption="The current screenshot: two identical pill rows with search between. Same visual weight on both rows means the user can't tell which is the page and which is the filter. Shown here only so the team sees why A–C are better."
      >
        <TwoRowAntiPattern />
      </Bay>
    </div>
  );
}

/* ════════════════════════ 3 · INPUTS ══════════════════════════════════════ */

/** Thin stateful wrapper over the real {@link TextField} primitive for the showroom. */
function FloatField({ label, type = 'text' }: { label: string; type?: string }) {
  const [v, setV] = useState('');
  return <TextField label={label} value={v} onChange={setV} type={type} />;
}

export function InputsSection() {
  const [q, setQ] = useState('');
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Bay title="Floating-label field" promote="@/design-system/primitives/TextField" tag="new" caption="Label animates into the border on focus/fill. Replaces the static label-above-input forms.">
        <div className="w-full max-w-[220px] space-y-3">
          <FloatField label="Order ID" />
          <FloatField label="Tracking #" />
        </div>
      </Bay>
      <Bay title="Search field — clearable" promote="@/design-system/primitives/SearchField" tag="upgrade" caption="Leading icon, focus ring, inline clear. Standardizes the many bespoke search inputs.">
        <div className="relative w-full max-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search orders…"
            className="w-full rounded-xl border border-border-soft bg-surface-card py-2 pl-9 pr-8 text-[13px] text-text-default outline-none transition-shadow duration-150 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
          />
          <AnimatePresence>
            {q && (
              <motion.button
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                onClick={() => setQ('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-text-muted hover:bg-surface-canvas"
              >
                <X className="h-3.5 w-3.5" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </Bay>
      <Bay title="Toggle switch" promote="@/design-system/primitives/Switch" tag="new" caption="Spring-driven thumb. For settings & filters.">
        <SwitchDemo />
      </Bay>
    </div>
  );
}

function SwitchDemo() {
  const [on, setOn] = useState(true);
  return (
    <button
      onClick={() => setOn((v) => !v)}
      className={cx('flex h-7 w-12 items-center rounded-full p-0.5 transition-colors duration-200', on ? 'bg-emerald-500' : 'bg-slate-300')}
    >
      <motion.span layout transition={spring} className={cx('h-6 w-6 rounded-full bg-white shadow', on && 'ml-auto')} />
    </button>
  );
}

/* ════════════════════════ 4 · DATA DISPLAY ════════════════════════════════ */

const ROWS = [
  { id: 'SO-4821', sku: 'MBP-16-M3', qty: 2, status: 'Shipped', carrier: 'UPS' },
  { id: 'SO-4822', sku: 'IPH-15-PRO', qty: 1, status: 'Packing', carrier: '—' },
  { id: 'SO-4823', sku: 'DELL-XPS13', qty: 4, status: 'Pending', carrier: '—' },
  { id: 'SO-4824', sku: 'SONY-WH1000', qty: 3, status: 'Shipped', carrier: 'FedEx' },
] as const;

const statusTone: Record<string, string> = {
  Shipped: 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/25',
  Packing: 'bg-amber-500/12 text-amber-600 ring-amber-500/25',
  Pending: 'bg-slate-500/10 text-text-muted ring-border-soft',
};

export function DataTableSection({ density }: { density: Density }) {
  const [sel, setSel] = useState<string[]>(['SO-4821']);
  const all = sel.length === ROWS.length;
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div className="grid grid-cols-1 gap-3">
      <Bay
        title="DataTable — selection · status · density"
        promote="@/design-system/components/DataTable"
        tag="new"
        caption="One table family replaces ~6 hand-rolled sticky-header tables. Reacts to the density toggle in the toolbar. Hover a row; toggle the checkboxes."
        span={2}
      >
        <div className="w-full overflow-hidden rounded-xl border border-border-soft bg-surface-card">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border-soft bg-surface-canvas/70 text-[10px] font-bold uppercase tracking-wide text-text-muted">
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={all}
                    onChange={() => setSel(all ? [] : ROWS.map((r) => r.id))}
                    className="h-3.5 w-3.5 accent-blue-600"
                  />
                </th>
                <th className="px-3 py-2.5">Order</th>
                <th className="px-3 py-2.5">SKU</th>
                <th className="px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Carrier</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, i) => {
                const on = sel.includes(r.id);
                return (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...softSpring, delay: i * 0.04 }}
                    onClick={() => toggle(r.id)}
                    className={cx(
                      'cursor-pointer border-b border-border-soft/70 text-[12px] transition-colors duration-150 last:border-0',
                      on ? 'bg-blue-500/[0.06]' : 'hover:bg-surface-canvas/70',
                    )}
                  >
                    <td className={cx('px-3', densityPad[density])}>
                      <input type="checkbox" checked={on} readOnly className="h-3.5 w-3.5 accent-blue-600" />
                    </td>
                    <td className={cx('px-3 font-mono font-semibold text-text-default', densityPad[density])}>{r.id}</td>
                    <td className={cx('px-3 font-mono text-text-muted', densityPad[density])}>{r.sku}</td>
                    <td className={cx('px-3 text-right tabular-nums text-text-default', densityPad[density])}>{r.qty}</td>
                    <td className={cx('px-3', densityPad[density])}>
                      <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1', statusTone[r.status])}>
                        {r.status}
                      </span>
                    </td>
                    <td className={cx('px-3 text-text-muted', densityPad[density])}>{r.carrier}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Bay>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Orders today" value={128} delta={+12.4} data={[8, 12, 9, 14, 11, 18, 22]} icon={Package} />
        <StatCard label="Shipped" value={94} delta={+4.1} data={[10, 11, 9, 12, 13, 12, 15]} icon={Truck} tone="emerald" />
        <StatCard label="Late" value={6} delta={-8.0} data={[12, 9, 10, 7, 8, 6, 6]} icon={AlertTriangle} tone="rose" />
      </div>
    </div>
  );
}

function Sparkline({ data, tone }: { data: number[]; tone: string }) {
  const w = 80;
  const h = 28;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const pts = data
    .map((d, i) => `${(i / (data.length - 1)) * w},${h - ((d - min) / (max - min || 1)) * h}`)
    .join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible">
      <motion.polyline
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
        points={pts}
        fill="none"
        stroke={tone}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatCard({
  label,
  value,
  delta,
  data,
  icon: Icon,
  tone = 'blue',
}: {
  label: string;
  value: number;
  delta: number;
  data: number[];
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'blue' | 'emerald' | 'rose';
}) {
  const stroke = { blue: '#3b82f6', emerald: '#10b981', rose: '#f43f5e' }[tone];
  const up = delta >= 0;
  return (
    <div className="flex flex-col rounded-2xl border border-border-soft bg-surface-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
        <span className="rounded-lg bg-surface-canvas p-1.5 text-text-muted ring-1 ring-border-soft">
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <AnimatedNumber value={value} className="text-2xl font-bold tracking-tight text-text-default" />
          <div className={cx('mt-0.5 flex items-center gap-0.5 text-[11px] font-bold', up ? 'text-emerald-600' : 'text-rose-600')}>
            <TrendingUp className={cx('h-3 w-3', !up && 'rotate-180')} />
            {up ? '+' : ''}
            {delta}%
          </div>
        </div>
        <Sparkline data={data} tone={stroke} />
      </div>
    </div>
  );
}

function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const mv = useMotionValue(0);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const controls = animate(mv, value, { duration: 1, ease: 'easeOut', onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [mv, value]);
  return <div className={className}>{shown}</div>;
}

/* ════════════════════════ 5 · OVERLAYS ════════════════════════════════════ */

export function OverlaysSection() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Bay title="Dialog — focus-trapped modal" promote="@/design-system/components/Dialog" tag="new" caption="Replaces every hand-rolled fixed inset-0 z-[80] modal. Spring scale-in, blurred backdrop, ESC + click-outside, scrolls behind.">
        <DialogDemo />
      </Bay>
      <Bay title="Command palette — ⌘K" promote="@/components/CommandBar (surfaced)" tag="upgrade" caption="The CommandBar you already have, made discoverable. Press ⌘K / Ctrl-K or click. Type to filter.">
        <CommandDemo />
      </Bay>
      <Bay title="Popover" promote="@/design-system/primitives/Popover" tag="new" caption="Positioned overlay primitive — kills the inline style={{position:'fixed'}} hacks in ViewDropdown.">
        <PopoverDemo />
      </Bay>
      <Bay title="Tooltip" promote="@/design-system/primitives/Tooltip" tag="new" caption="Hover the icon. Delayed fade, arrow, token-themed.">
        <div className="flex gap-4">
          <Tooltip label="Reprint label"><span className="rounded-lg border border-border-soft p-2 text-text-muted"><Printer className="h-4 w-4" /></span></Tooltip>
          <Tooltip label="Delete order"><span className="rounded-lg border border-border-soft p-2 text-text-muted"><Trash2 className="h-4 w-4" /></span></Tooltip>
          <Tooltip label="Mark shipped"><span className="rounded-lg border border-border-soft p-2 text-text-muted"><Check className="h-4 w-4" /></span></Tooltip>
        </div>
      </Bay>
    </div>
  );
}

function DialogDemo() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <Btn variant="secondary">
        <span onClick={() => setOpen(true)}>Open dialog</span>
      </Btn>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={spring}
              className="relative z-10 w-full max-w-sm rounded-2xl border border-border-soft bg-surface-card p-5 shadow-2xl"
            >
              <div className="mb-1 flex items-center justify-between">
                <h4 className="text-sm font-bold text-text-default">Confirm shipment</h4>
                <button onClick={() => setOpen(false)} className="rounded-md p-1 text-text-muted hover:bg-surface-canvas">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-[13px] leading-relaxed text-text-muted">
                Mark order <span className="font-mono font-semibold text-text-default">SO-4821</span> as shipped and print the label?
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Btn variant="ghost"><span onClick={() => setOpen(false)}>Cancel</span></Btn>
                <Btn variant="primary" icon={Printer}>
                  <span onClick={() => { setOpen(false); toast.success('Order shipped · label sent to printer'); }}>Ship · Print</span>
                </Btn>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

const COMMANDS = [
  { icon: Package, label: 'Go to Orders', hint: 'Navigate' },
  { icon: Truck, label: 'Create FBA shipment', hint: 'Action' },
  { icon: Printer, label: 'Reprint last label', hint: 'Action' },
  { icon: Search, label: 'Find order by tracking #', hint: 'Search' },
  { icon: Settings, label: 'Open settings', hint: 'Navigate' },
];

function CommandDemo() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 40);
    else setQ('');
  }, [open]);
  const results = COMMANDS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-border-soft bg-surface-card px-3 py-2 text-[12px] text-text-muted hover:bg-surface-canvas"
      >
        <Search className="h-3.5 w-3.5" /> Search…
        <kbd className="ml-1 rounded border border-border-soft bg-surface-canvas px-1.5 py-0.5 font-mono text-[10px] text-text-muted">⌘K</kbd>
      </button>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 pt-[16vh]">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -6 }}
              transition={spring}
              className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-border-soft bg-surface-card shadow-2xl"
            >
              <div className="flex items-center gap-2 border-b border-border-soft px-4">
                <Search className="h-4 w-4 text-text-muted" />
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Type a command or search…"
                  className="w-full bg-transparent py-3.5 text-[13px] text-text-default outline-none placeholder:text-text-muted"
                />
              </div>
              <div className="max-h-64 overflow-y-auto p-1.5">
                {results.length === 0 ? (
                  <p className="px-3 py-6 text-center text-[12px] text-text-muted">No matches</p>
                ) : (
                  results.map((c) => (
                    <button
                      key={c.label}
                      onClick={() => { setOpen(false); toast(c.label); }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] text-text-default hover:bg-surface-canvas"
                    >
                      <c.icon className="h-4 w-4 text-text-muted" />
                      <span className="flex-1">{c.label}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{c.hint}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

function PopoverDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Btn variant="secondary"><span onClick={() => setOpen((v) => !v)}>Filters</span></Btn>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.97 }}
              transition={softSpring}
              className="absolute left-1/2 top-full z-20 mt-2 w-44 -translate-x-1/2 rounded-xl border border-border-soft bg-surface-card p-1.5 shadow-xl"
            >
              {['Shipped', 'Pending', 'Late', 'On hold'].map((o) => (
                <button key={o} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-text-default hover:bg-surface-canvas">
                  <span className="h-3.5 w-3.5 rounded border border-border-soft" />
                  {o}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      <AnimatePresence>
        {show && (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute -top-8 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white shadow-lg"
          >
            {label}
            <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/* ════════════════════════ 6 · FEEDBACK ════════════════════════════════════ */

export function FeedbackSection() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Bay title="Toasts — Sonner" promote="@/lib/toast (already wired)" tag="have" caption="Already installed app-wide; just never demoed. Trigger each kind.">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Btn variant="secondary"><span onClick={() => toast.success('Order shipped')}>Success</span></Btn>
          <Btn variant="secondary"><span onClick={() => toast.error('Print failed')}>Error</span></Btn>
          <Btn variant="secondary"><span onClick={() => toast('Synced 12 orders', { icon: '🔄' })}>Info</span></Btn>
          <Btn variant="secondary">
            <span onClick={() => toast.promise(new Promise((r) => setTimeout(r, 1400)), { loading: 'Syncing…', success: 'Synced', error: 'Failed' })}>Promise</span>
          </Btn>
        </div>
      </Bay>
      <Bay title="Skeleton — shimmer" promote="@/design-system/components/Skeletons (shimmer)" tag="upgrade" caption="Moving-highlight loading state — the 2026 default over a flat pulse.">
        <div className="w-full max-w-[240px] space-y-2.5">
          <Shimmer className="h-9 w-full rounded-xl" />
          <Shimmer className="h-3 w-3/4 rounded" />
          <Shimmer className="h-3 w-1/2 rounded" />
        </div>
      </Bay>
      <Bay title="Empty state" promote="@/components/ui/EmptyState" tag="upgrade" caption="Illustrated zero-state with a primary action. You have EmptyState — this adds polish + CTA.">
        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-canvas ring-1 ring-border-soft">
            <Package className="h-6 w-6 text-text-muted" />
          </div>
          <p className="text-[13px] font-semibold text-text-default">No pending orders</p>
          <p className="mt-0.5 max-w-[200px] text-[11px] text-text-muted">Everything's shipped. New orders land here automatically.</p>
          <Btn variant="primary" icon={Plus} className="mt-3"><span>Create manual order</span></Btn>
        </div>
      </Bay>
      <Bay title="Error / inline banner" promote="@/design-system/components/InlineNotice" tag="new" caption="Consistent error + warning surface for failed syncs, validation, etc.">
        <div className="w-full space-y-2">
          <div className="flex items-start gap-2.5 rounded-xl bg-rose-500/[0.08] p-3 ring-1 ring-rose-500/20">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <div>
              <p className="text-[12px] font-semibold text-rose-700">Zoho sync failed</p>
              <p className="text-[11px] text-rose-600/80">Token expired — reconnect the integration.</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/[0.08] p-3 ring-1 ring-amber-500/20">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-[12px] font-semibold text-amber-700">3 orders missing tracking numbers</p>
          </div>
        </div>
      </Bay>
    </div>
  );
}

function Shimmer({ className }: { className?: string }) {
  return (
    <div className={cx('relative overflow-hidden bg-surface-canvas', className)}>
      <motion.div
        animate={{ x: ['-100%', '200%'] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
        className="absolute inset-0 w-1/2 bg-gradient-to-r from-transparent via-white/60 to-transparent"
      />
    </div>
  );
}

/* ════════════════════════ 7 · MOTION LAB ══════════════════════════════════ */

export function MotionSection() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Bay title="Shared-element expand" promote="motion layoutId" tag="new" caption="Click the card — it morphs open with a shared layout transition. The pattern behind detail-panel reveals.">
        <ExpandCard />
      </Bay>
      <Bay title="Spring press" promote="whileTap" tag="new" caption="Press-and-hold tactility on any control.">
        <motion.button whileTap={{ scale: 0.88 }} transition={spring} className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/30">
          <Check className="h-5 w-5" />
        </motion.button>
      </Bay>
      <Bay title="Stagger reveal" promote="staggerChildren" tag="new" caption="List items cascade in. For freshly-loaded queues.">
        <StaggerList />
      </Bay>
    </div>
  );
}

function ExpandCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-28 items-center justify-center">
      <AnimatePresence mode="wait">
        {!open ? (
          <motion.button
            layoutId="exp"
            onClick={() => setOpen(true)}
            transition={softSpring}
            className="flex items-center gap-2 rounded-2xl border border-border-soft bg-surface-card px-4 py-3 shadow-sm"
          >
            <motion.span layoutId="exp-dot" className="h-8 w-8 rounded-xl bg-blue-600" />
            <motion.span layoutId="exp-label" className="text-[12px] font-semibold text-text-default">SO-4821</motion.span>
          </motion.button>
        ) : (
          <motion.div
            layoutId="exp"
            onClick={() => setOpen(false)}
            transition={softSpring}
            className="w-full max-w-[220px] cursor-pointer rounded-2xl border border-border-soft bg-surface-card p-3 shadow-lg"
          >
            <div className="flex items-center gap-2">
              <motion.span layoutId="exp-dot" className="h-8 w-8 rounded-xl bg-blue-600" />
              <motion.span layoutId="exp-label" className="text-[12px] font-semibold text-text-default">SO-4821</motion.span>
            </div>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 text-[11px] text-text-muted">
              2× MBP-16-M3 · UPS · ships today. Tap to collapse.
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StaggerList() {
  const [key, setKey] = useState(0);
  return (
    <div className="w-full max-w-[180px]">
      <motion.ul key={key} initial="hide" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }} className="space-y-1.5">
        {['SO-4821', 'SO-4822', 'SO-4823'].map((o) => (
          <motion.li
            key={o}
            variants={{ hide: { opacity: 0, x: -12 }, show: { opacity: 1, x: 0 } }}
            transition={softSpring}
            className="rounded-lg border border-border-soft bg-surface-card px-3 py-2 font-mono text-[11px] font-semibold text-text-default"
          >
            {o}
          </motion.li>
        ))}
      </motion.ul>
      <button onClick={() => setKey((k) => k + 1)} className="mt-2 text-[11px] font-semibold text-blue-600 hover:underline">
        Replay ↻
      </button>
    </div>
  );
}
