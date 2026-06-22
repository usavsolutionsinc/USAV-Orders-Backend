'use client';

/**
 * /design-demo — the design-system showcase (P0-DS-01).
 *
 * Renders the standardized primitives against the live token set so the
 * foundation can be eyeballed in one place. Each bay names the primitive's
 * source path. The card-fan / photo-peek isolation harnesses live at
 * /design-demo/card-fan and /design-demo/photo-peek.
 *
 * Everything here consumes design tokens (semantic surface/text/border classes)
 * and the SHARED motion presets — no hand-rolled values, no bespoke transitions.
 */

import { useRef, useState } from 'react';
import { Plus, Search } from '@/components/Icons';
import {
  Button,
  Panel,
  PanelHeader,
  PanelFooter,
  Popover,
  Toolbar,
  ToolbarSeparator,
  EmptyState,
} from '@/design-system/primitives';
import { StatusBadge, DataTable, type DataTableColumn } from '@/design-system/components';
import { EventTimeline } from '@/components/ui/EventTimeline';
import type { TimelineItem } from '@/lib/timeline/types';

// ─── Demo data ───────────────────────────────────────────────────────────────

interface DemoUnit {
  serial: string;
  sku: string;
  condition: string;
  status: string;
}

const DEMO_ROWS: DemoUnit[] = [
  { serial: 'SBLINK-2425-000017', sku: 'BOSE-SL-REV', condition: 'Used – Good', status: 'shipped' },
  { serial: 'WH1000XM4-2425-000042', sku: 'SONY-XM4', condition: 'New', status: 'confirmed' },
  { serial: 'AIRPODSP-2425-000108', sku: 'APPLE-APP2', condition: 'Used – Fair', status: 'overdue' },
  { serial: 'JBLFLIP6-2425-000231', sku: 'JBL-FLIP6', condition: 'Parts', status: 'void' },
];

const DEMO_COLUMNS: DataTableColumn<DemoUnit>[] = [
  { key: 'serial', header: 'Serial', cell: (r) => <span className="font-mono">{r.serial}</span> },
  { key: 'sku', header: 'SKU', cell: (r) => <span className="font-mono">{r.sku}</span> },
  { key: 'condition', header: 'Condition', cell: (r) => r.condition },
  { key: 'status', header: 'Status', align: 'right', cell: (r) => <StatusBadge status={r.status} /> },
];

const DEMO_TIMELINE: TimelineItem[] = [
  { id: 1, at: new Date(Date.now() - 1000 * 60 * 5).toISOString(), title: 'Ship-confirmed', tone: 'success', actor: 'A. Rivera', ref: { value: '9400111899560000000000', kind: 'tracking' } },
  { id: 2, at: new Date(Date.now() - 1000 * 60 * 90).toISOString(), title: 'Label printed', tone: 'info', actor: 'A. Rivera' },
  { id: 3, at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), title: 'Tested · passed', tone: 'success', subtitle: 'Bench 3', actor: 'M. Lee' },
  { id: 4, at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(), title: 'Received at dock', tone: 'muted', actor: 'System' },
];

// ─── Bay wrapper ─────────────────────────────────────────────────────────────

function Bay({ title, path, children }: { title: string; path: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between gap-3 border-b border-border-soft pb-2">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-text-default">{title}</h2>
        <code className="text-micro text-text-muted">{path}</code>
      </header>
      {children}
    </section>
  );
}

export default function DesignShowcasePage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverAnchor = useRef<HTMLButtonElement>(null);

  return (
    <div className="min-h-screen w-full bg-surface-canvas">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-10">
        <header className="space-y-1">
          <h1 className="text-2xl font-black text-text-default">Design System · Showcase</h1>
          <p className="text-sm text-text-muted">
            Standardized primitives on the live token set (P0-DS-01). Every surface below
            consumes semantic tokens + the shared motion presets.
          </p>
        </header>

        {/* Toolbar primitive */}
        <Bay title="Toolbar" path="design-system/primitives/Toolbar.tsx">
          <Panel padding="none" radius="xl" elevation="sm">
            <Toolbar
              start={<span className="text-sm font-bold text-text-default">Inventory</span>}
              center={
                <div className="flex items-center gap-1.5 rounded-lg border border-border-soft px-2.5 py-1 text-sm text-text-muted">
                  <Search className="h-3.5 w-3.5" /> Search units…
                </div>
              }
              end={
                <>
                  <Button size="sm" variant="ghost">Filter</Button>
                  <ToolbarSeparator />
                  <Button size="sm" variant="brand" icon={<Plus />}>Add</Button>
                </>
              }
            />
          </Panel>
        </Bay>

        {/* Button + Badge + Popover */}
        <Bay title="Button · Badge · Popover" path="primitives/Button.tsx · components/StatusBadge.tsx · primitives/Popover.tsx">
          <Panel className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="brand">Brand</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" loading>Loading</Button>

            <ToolbarSeparator />
            <StatusBadge status="shipped" />
            <StatusBadge status="confirmed" />
            <StatusBadge status="overdue" />
            <StatusBadge status="paid" />

            <ToolbarSeparator />
            <Button
              ref={popoverAnchor}
              variant="secondary"
              aria-haspopup="menu"
              aria-expanded={popoverOpen}
              onClick={() => setPopoverOpen((o) => !o)}
            >
              Open popover
            </Button>
            <Popover
              open={popoverOpen}
              onClose={() => setPopoverOpen(false)}
              anchorRef={popoverAnchor}
              role="menu"
              aria-label="Row actions"
            >
              <div className="flex w-44 flex-col text-sm">
                {['Rename', 'Duplicate', 'Archive'].map((label) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    onClick={() => setPopoverOpen(false)}
                    className="rounded-lg px-2.5 py-1.5 text-left text-text-default hover:bg-surface-canvas"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Popover>
          </Panel>
        </Bay>

        {/* DataTable */}
        <Bay title="DataTable" path="design-system/components/DataTable/">
          <DataTable
            columns={DEMO_COLUMNS}
            rows={DEMO_ROWS}
            rowKey={(r) => r.serial}
            isRowSelected={(r) => r.serial === selected}
            onRowClick={(r) => setSelected(r.serial)}
          />
          {/* Empty state — same surface, EmptyState fallback. */}
          <DataTable<DemoUnit>
            columns={DEMO_COLUMNS}
            rows={[]}
            rowKey={(r) => r.serial}
          />
        </Bay>

        {/* Panel */}
        <Bay title="Panel" path="design-system/primitives/Panel.tsx">
          <Panel padding="lg">
            <PanelHeader
              title="Diagnostics"
              subtitle="A static, token-driven surface container."
              actions={<StatusBadge status="active" />}
            />
            <p className="mt-4 text-sm text-text-muted">
              Panel is the calm sibling of CardShell — a plain bordered surface for
              settings cards and detail sections. Radius, elevation, and padding map
              onto the token scale.
            </p>
            <PanelFooter>
              <Button size="sm" variant="primary">Save</Button>
              <Button size="sm" variant="ghost">Cancel</Button>
            </PanelFooter>
          </Panel>

          {/* Elevation + borderless variants. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Panel padding="sm" elevation="none">
              <div className="text-xs font-semibold text-text-default">elevation=none</div>
            </Panel>
            <Panel padding="sm" elevation="md">
              <div className="text-xs font-semibold text-text-default">elevation=md</div>
            </Panel>
            <Panel padding="sm" elevation="none" borderless>
              <div className="text-xs font-semibold text-text-default">borderless</div>
            </Panel>
          </div>
        </Bay>

        {/* Timeline */}
        <Bay title="Timeline" path="src/components/ui/EventTimeline.tsx">
          <Panel padding="lg">
            <EventTimeline items={DEMO_TIMELINE} />
          </Panel>
        </Bay>

        {/* EmptyState */}
        <Bay title="EmptyState" path="design-system/primitives/EmptyState.tsx">
          <Panel padding="none" radius="xl">
            <EmptyState
              icon={<Search className="h-6 w-6 text-text-muted" />}
              title="No results"
              description="Nothing matched your filters. Try widening the search."
              action={<Button size="sm" variant="secondary">Clear filters</Button>}
            />
          </Panel>
        </Bay>
      </div>
    </div>
  );
}
