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
 * later phase — see docs/NODE_UI_PLAN.md). Live occupancy per state is pulled
 * from /api/workflow/flow-audit purely as a "how many units are here right now"
 * annotation, so the description reflects what's currently happening.
 */

import { useEffect, useState } from 'react';
import { FLOWS, type OpsFlow } from './operations-catalog';

type Occupancy = Record<string, number>;

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

  return (
    <div className="h-full min-h-0 w-full overflow-auto bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h2 className="text-base font-bold tracking-tight text-slate-900">Operations · System flows</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          The item flows currently implemented in the codebase, end to end. Each step shows the lifecycle
          state, the station that owns it, and the signal that marks it.
        </p>
      </header>

      <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
        {FLOWS.map((flow) => (
          <FlowCard key={flow.key} flow={flow} occupancy={occupancy} />
        ))}
      </div>
    </div>
  );
}

function FlowCard({ flow, occupancy }: { flow: OpsFlow; occupancy: Occupancy }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Flow header */}
      <div className="border-b border-slate-100 px-5 py-3.5" style={{ borderLeft: `4px solid ${flow.color}` }}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900">{flow.label}</h3>
          <div className="flex flex-wrap justify-end gap-1">
            {flow.stations.map((s) => (
              <span key={s} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                {s}
              </span>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-500">{flow.blurb}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Source</span>
          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">{flow.source}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Implemented in</span>
          {flow.code.map((c) => (
            <span key={c} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
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
                  className="z-10 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white"
                  style={{ background: flow.color }}
                >
                  {idx + 1}
                </span>
                {!last && <span className="absolute top-6 h-full w-px bg-slate-200" />}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-md px-2 py-0.5 text-[12px] font-bold"
                    style={{ background: `${flow.color}18`, color: flow.color }}
                  >
                    {step.stage}
                  </span>
                  {step.key && step.key !== step.stage && (
                    <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                      {step.key}
                    </span>
                  )}
                  <span className="text-[11px] font-semibold text-slate-500">{step.station}</span>
                  {step.signal && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                      {step.signal}
                    </span>
                  )}
                  {typeof here === 'number' && here > 0 && (
                    <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {here.toLocaleString()} here now
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-600">{step.note}</p>
                {step.by && (
                  <p className="mt-0.5 font-mono text-[10px] text-slate-400">↳ {step.by}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Off-path / branches */}
      {flow.offPath && flow.offPath.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Branches &amp; terminal states
          </p>
          <ul className="space-y-1">
            {flow.offPath.map((b) => (
              <li key={b.stage} className="flex items-baseline gap-2 text-[11px]">
                <span className="shrink-0 rounded bg-slate-200/70 px-1.5 py-0.5 font-semibold text-slate-600">{b.stage}</span>
                <span className="text-slate-500">{b.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
