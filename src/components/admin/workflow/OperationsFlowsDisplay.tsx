'use client';

/**
 * OperationsFlowsDisplay — the main Operations panel.
 *
 * A read-only, descriptive display of the flows that actually exist in the
 * codebase today (receiving / shipping / FBA / repair / returns). Each flow is
 * shown in full — no dropdowns, no click-to-reveal — as an ordered sequence of
 * lifecycle states, the station that owns each step, the real signal
 * (activity/event type) that marks it, and the modules/routes that implement it.
 *
 * It's intentionally non-interactive for now (the interactive node canvas is the
 * later phase — see docs/operations-studio/NODE_UI_PLAN.md). Live occupancy per state is pulled
 * from /api/workflow/flow-audit purely as a "how many units are here right now"
 * annotation, so the description reflects what's currently happening.
 */

import { useEffect, useMemo, useState } from 'react';
import { FLOWS, type OpsFlow } from './operations-catalog';

type Occupancy = Record<string, number>;

/** Section order for the grouped flow display. */
const GROUP_ORDER = ['Sourcing & intake', 'Outbound', 'Reverse & service', 'Inventory & ops'];

export function OperationsFlowsDisplay() {
  const [occupancy, setOccupancy] = useState<Occupancy>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/workflow/flow-audit?days=365', { cache: 'no-store' });
        const data = await res.json();
        if (alive && data?.ok) {
          const map: Occupancy = {};
          for (const n of data.nodes as { status: string; count: number }[]) map[n.status] = n.count;
          setOccupancy(map);
        }
      } catch {
        /* counts are optional; the description stands on its own */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const sections = useMemo(() => {
    const known = GROUP_ORDER.map((group) => ({
      group,
      flows: FLOWS.filter((f) => f.group === group).sort((a, b) => a.order - b.order),
    }));
    // Any flow whose group isn't in GROUP_ORDER still shows (defensive).
    const extra = FLOWS.filter((f) => !GROUP_ORDER.includes(f.group));
    if (extra.length) known.push({ group: 'Other', flows: extra.sort((a, b) => a.order - b.order) });
    return known.filter((s) => s.flows.length > 0);
  }, []);

  return (
    <div className="h-full min-h-0 w-full overflow-auto bg-surface-canvas">
      <header className="border-b border-border-soft bg-surface-card px-6 py-4">
        <h2 className="text-base font-bold tracking-tight text-text-default">Operations · System flows</h2>
        <p className="mt-0.5 text-xs text-text-soft">
          The {FLOWS.length} item flows currently implemented in the codebase, end to end. Each step shows the
          lifecycle stage, the station that owns it, the signal that marks it, and the route that performs it.
        </p>
      </header>

      <div className="mx-auto max-w-3xl space-y-8 px-6 py-6">
        {sections.map((section) => (
          <div key={section.group}>
            <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-faint">
              {section.group}
              <span className="rounded-full bg-surface-strong px-1.5 py-0.5 text-micro font-semibold text-text-soft">
                {section.flows.length}
              </span>
            </h3>
            <div className="space-y-5">
              {section.flows.map((flow) => (
                <FlowCard key={flow.key} flow={flow} occupancy={occupancy} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowCard({ flow, occupancy }: { flow: OpsFlow; occupancy: Occupancy }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border-soft bg-surface-card shadow-sm">
      {/* Flow header */}
      <div className="border-b border-border-hairline px-5 py-3.5" style={{ borderLeft: `4px solid ${flow.color}` }}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-text-default">{flow.label}</h3>
          <div className="flex flex-wrap justify-end gap-1">
            {flow.stations.map((s) => (
              <span key={s} className="rounded-md bg-surface-sunken px-1.5 py-0.5 text-micro font-semibold text-text-muted">
                {s}
              </span>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs text-text-soft">{flow.blurb}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-micro font-bold uppercase tracking-wider text-text-faint">Source</span>
          <span className="rounded border border-border-soft bg-surface-canvas px-1.5 py-0.5 font-mono text-micro text-text-muted">{flow.source}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-micro font-bold uppercase tracking-wider text-text-faint">Implemented in</span>
          {flow.code.map((c) => (
            <span key={c} className="rounded border border-border-soft bg-surface-canvas px-1.5 py-0.5 font-mono text-micro text-text-muted">
              {c}
            </span>
          ))}
        </div>
      </div>

      {/* Steps */}
      <ol className="px-5 py-3">
        {flow.steps.map((step, idx) => {
          const here = step.key ? occupancy[step.key] : undefined;
          const last = idx === flow.steps.length - 1;
          return (
            <li key={`${step.stage}-${idx}`} className="relative flex gap-3 pb-3 last:pb-0">
              {/* Rail + node */}
              <div className="relative flex flex-col items-center">
                <span
                  className="z-10 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-micro font-bold text-white ring-2 ring-white"
                  style={{ background: flow.color }}
                >
                  {idx + 1}
                </span>
                {!last && <span className="absolute top-6 h-full w-px bg-surface-strong" />}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-md px-2 py-0.5 text-label font-bold"
                    style={{ background: `${flow.color}18`, color: flow.color }}
                  >
                    {step.stage}
                  </span>
                  {step.key && step.key !== step.stage && (
                    <span className="rounded border border-border-soft bg-surface-card px-1.5 py-0.5 font-mono text-micro text-text-faint">
                      {step.key}
                    </span>
                  )}
                  <span className="text-caption font-semibold text-text-soft">{step.station}</span>
                  {step.signal && (
                    <span className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-micro text-text-soft">
                      {step.signal}
                    </span>
                  )}
                  {typeof here === 'number' && here > 0 && (
                    <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-micro font-semibold text-emerald-700">
                      {here.toLocaleString()} here now
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-text-muted">{step.note}</p>
                {step.by && (
                  <p className="mt-0.5 font-mono text-micro text-text-faint">↳ {step.by}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Off-path / branches */}
      {flow.offPath && flow.offPath.length > 0 && (
        <div className="border-t border-border-hairline bg-surface-canvas/60 px-5 py-3">
          <p className="mb-1.5 text-micro font-bold uppercase tracking-wider text-text-faint">
            Branches &amp; terminal states
          </p>
          <ul className="space-y-1">
            {flow.offPath.map((b) => (
              <li key={b.stage} className="flex items-baseline gap-2 text-caption">
                <span className="shrink-0 rounded bg-surface-strong/70 px-1.5 py-0.5 font-semibold text-text-muted">{b.stage}</span>
                <span className="text-text-soft">{b.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
