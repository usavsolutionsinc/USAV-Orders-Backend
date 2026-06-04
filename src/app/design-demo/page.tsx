'use client';

/**
 * /design-demo — the 2026 component showroom.
 *
 * A section-navigable gallery of modernized, *working* components rendered in
 * their real states. Browse, flip light/dark + density, and cherry-pick: each
 * <Bay> header shows the path the component lands at when you promote it into
 * the design system. Built on the stack already shipped (Tailwind + Framer
 * Motion + Sonner + the CSS-variable tokens), so picks drop in natively.
 *
 * The whole page is themed through the design-system CSS variables
 * (surface-card / text-default / border-soft …). Those tokens exist but are
 * barely used in the app — this page dogfoods them, which is why the Light/Dark
 * switch below actually works with zero per-component dark: classes.
 *
 * Throwaway route — not imported by the app. Delete src/app/design-demo anytime.
 */

import { useRef, useState } from 'react';
import { Database, Zap, Bell, Sparkles, Search, List, Package, MapPin } from '@/components/Icons';
import {
  ButtonsSection,
  InputsSection,
  DataTableSection,
  FeedbackSection,
  MotionSection,
  SectionHeading,
  cx,
  type Density,
} from './_gallery/sections';
import { ConditionPickerSection } from './_gallery/condition-picker-section';
import { WarehouseMapSection } from './_gallery/warehouse-map-section';
import { WarehouseFlowSection } from './_gallery/warehouse-flow-section';
import { FilterBarSection } from './_gallery/filter-bar-section';

type SectionDef = {
  id: string;
  index: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  blurb: string;
  render: (density: Density) => React.ReactNode;
};

const SECTIONS: SectionDef[] = [
  { id: 'buttons', index: '01', label: 'Buttons & actions', icon: Zap, blurb: 'A single Button primitive with spring-press feedback, async loading, and brand gradient — replacing the ad-hoc <button> markup repeated across sidebars and forms.', render: () => <ButtonsSection /> },
  { id: 'filters', index: '02', label: 'Filter bars', icon: Search, blurb: 'Unified search + pills + advanced popovers. Consolidating the collapsible UpNext bar, the popover-heavy Shipped toolbar, and the inline Bins chips into a single polymorphic component.', render: () => <FilterBarSection /> },
  { id: 'condition', index: '2d', label: 'Condition picker', icon: Package, blurb: 'Condensing the PO-items grade picker into one contextual row. Today it shows the full set of pills at all times; these variants keep the current grade on the left and reveal the rest only on demand — popover, inline slide-out, or a select dropdown. Each is shown inside a mock of the real line-edit card so you can compare in context and cherry-pick.', render: (d) => <ConditionPickerSection density={d} /> },
  { id: 'inputs', index: '03', label: 'Inputs', icon: Search, blurb: 'Floating-label fields and a spring toggle — consolidating the inconsistent form styling between sidebar and admin forms.', render: () => <InputsSection /> },
  { id: 'data', index: '04', label: 'Data display', icon: Database, blurb: 'A DataTable family (selection, status pills, density-aware rows) to retire the ~6 hand-rolled sticky-header tables.', render: (d) => <DataTableSection density={d} /> },
  { id: 'warehouse-map', index: '05', label: 'Warehouse map · konva', icon: MapPin, blurb: 'The flat fill-% bin grid redrawn on a real canvas with react-konva — drag bins to reposition, select to resize (expand/shrink), scroll to zoom, drag empty space to pan, and flip Trace to follow one SKU across every zone it lives in. The spatial, "identify & move inventory" view the HTML table can\'t give you.', render: (d) => <WarehouseMapSection density={d} /> },
  { id: 'warehouse-flow', index: '5b', label: 'Warehouse map · React Flow', icon: MapPin, blurb: 'The exact same bins/zones/tones on @xyflow/react instead of konva — a head-to-head comparison. Nodes are real DOM (theme for free), Trace draws actual graph edges between same-SKU bins, and Controls + MiniMap come built in. Konva wins on raw shape count & pixel control; React Flow wins on edges/tracing and batteries-included chrome.', render: (d) => <WarehouseFlowSection density={d} /> },
  { id: 'feedback', index: '06', label: 'Feedback', icon: Bell, blurb: 'A polished empty state and a consistent inline error/warning banner.', render: () => <FeedbackSection /> },
  { id: 'motion', index: '07', label: 'Motion lab', icon: Sparkles, blurb: 'Shared-element expand, spring press, and stagger reveals — the highest-impact "2026" upgrades, all from your existing Framer Motion presets.', render: () => <MotionSection /> },
];

const DENSITIES: Density[] = ['compact', 'cozy', 'comfortable'];

export default function DesignDemoPage() {
  const [dark, setDark] = useState(false);
  const [density, setDensity] = useState<Density>('cozy');
  const [active, setActive] = useState(SECTIONS[0].id);
  const scrollRef = useRef<HTMLDivElement>(null);

  const goTo = (id: string) => {
    setActive(id);
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      data-theme={dark ? 'dark' : undefined}
      ref={scrollRef}
      className="h-full overflow-y-auto bg-surface-canvas"
    >
      {/* ── sticky toolbar ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-border-soft bg-surface-card/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-b from-navy-700 to-navy-900 text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="leading-tight">
              <p className="text-[13px] font-bold tracking-tight text-text-default">2026 Component Showroom</p>
              <p className="text-[10px] text-text-muted">Live · cherry-pick · promote</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* density */}
            <div className="hidden items-center gap-0.5 rounded-xl bg-surface-canvas p-0.5 ring-1 ring-border-soft sm:flex">
              {DENSITIES.map((d) => (
                <button
                  key={d}
                  onClick={() => setDensity(d)}
                  className={cx(
                    'rounded-lg px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors duration-150',
                    density === d ? 'bg-surface-card text-text-default shadow-sm ring-1 ring-border-soft' : 'text-text-muted hover:text-text-default',
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
            {/* theme */}
            <div className="flex items-center gap-0.5 rounded-xl bg-surface-canvas p-0.5 ring-1 ring-border-soft">
              {(['light', 'dark'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setDark(m === 'dark')}
                  className={cx(
                    'rounded-lg px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors duration-150',
                    (m === 'dark') === dark ? 'bg-surface-card text-text-default shadow-sm ring-1 ring-border-soft' : 'text-text-muted hover:text-text-default',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl gap-8 px-5 py-8">
        {/* ── left rail nav ────────────────────────────────────────────── */}
        <nav className="sticky top-[68px] hidden h-fit w-52 shrink-0 lg:block">
          <p className="mb-2 flex items-center gap-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-text-muted">
            <List className="h-3 w-3" /> Sections
          </p>
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => {
              const on = active === s.id;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => goTo(s.id)}
                    className={cx(
                      'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[12px] font-semibold transition-colors duration-150',
                      on ? 'bg-blue-500/[0.10] text-blue-600' : 'text-text-muted hover:bg-surface-card hover:text-text-default',
                    )}
                  >
                    <s.icon className="h-3.5 w-3.5" />
                    <span className="flex-1">{s.label}</span>
                    <span className="font-mono text-[9px] opacity-60">{s.index}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 rounded-xl border border-dashed border-border-soft p-3">
            <p className="text-[10px] leading-relaxed text-text-muted">
              Each card's mono path is where it lands when you say <span className="font-semibold text-text-default">“ship this one.”</span>
            </p>
          </div>
        </nav>

        {/* ── content ──────────────────────────────────────────────────── */}
        <main className="min-w-0 flex-1 space-y-12">
          {SECTIONS.map((s) => (
            <section key={s.id} id={`sec-${s.id}`} className="scroll-mt-[80px]">
              <SectionHeading index={s.index} title={s.label} blurb={s.blurb} />
              {s.render(density)}
            </section>
          ))}

          <footer className="border-t border-border-soft pt-5 text-center text-[11px] text-text-muted">
            Throwaway route · not imported by the app · delete{' '}
            <span className="font-mono">src/app/design-demo</span> any time.
          </footer>
        </main>
      </div>
    </div>
  );
}
