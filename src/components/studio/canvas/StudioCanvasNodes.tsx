import { Handle, Position, type NodeProps } from '@xyflow/react';
import { icons } from 'lucide-react';
import { workflowStage } from '@/lib/receiving/workflow-stages';
import { computeNodeHeat, type NodeHeat } from '@/lib/studio/live-heat';
import { computeFlowHeat } from '@/lib/studio/flow-heat';
import { X } from '@/components/Icons';
import { circledNumber, formatDuration, oldestAgeHours } from '../studio-types';
import {
  STATIC_ROLE,
  HEAT_TONE,
  HEAT_BADGE,
  HEAT_ACCENT,
  HEAT_DOT,
  formatAgeHours,
  staffInitials,
  stationOf,
  type AnnotationNodeData,
  type DepartmentNodeData,
  type ProcessNodeData,
} from './studio-canvas-shared';

// ─── Custom node renderers ───────────────────────────────────

function NodeIcon({ name, className }: { name: string | undefined; className?: string }) {
  const Icon = (name && (icons as Record<string, React.ComponentType<{ className?: string }>>)[name]) || icons.Box;
  return <Icon className={className} />;
}

export function ProcessNode({ data }: NodeProps) {
  const { node, dimmed, focused, live, gaps, staticRole, staticDangling, flow, flowBottleneck, people, simGhost } =
    data as ProcessNodeData;
  const station = stationOf(node);
  const states = Array.isArray(node.config.states) ? (node.config.states as string[]) : [];
  const slaHours = typeof node.config.slaHours === 'number' ? node.config.slaHours : null;

  // Live-lens heat: idle → active → warm → hot from occupancy + SLA + errors.
  const ageHours = oldestAgeHours(live);
  const heat: NodeHeat | null = live
    ? computeNodeHeat({ total: live.total, error: live.error, ageHours, slaHours })
    : null;

  // Flow²-lens heat: bottleneck / fail-rate / WIP backlog over the window.
  // Reuses the Live HeatLevel so the shared HEAT_* tone maps apply unchanged.
  const flowHeat = flow
    ? computeFlowHeat({
        currentWip: flow.currentWip,
        failRate: flow.failRate,
        runCount: flow.runCount,
        isBottleneck: flowBottleneck,
      })
    : null;

  const gapErrors = gaps.filter((d) => d.severity === 'error');
  const gapWarnings = gaps.filter((d) => d.severity === 'warning');

  // People lens: an uncovered node (no staff scoped to its station) is a coverage
  // gap — flag it amber, like a warning. A station-less node (ADMIN/none) can't be
  // covered, so it is not flagged as a gap.
  const peopleGap = !!people && people.coverage === 0 && people.station != null;

  // Static lens recolors the left accent by data-flow role (source/transform/sink).
  const accent = staticRole ? STATIC_ROLE[staticRole].color : (station?.color ?? '#94a3b8');

  return (
    <div
      className={[
        'relative w-56 rounded-xl border shadow-sm transition-opacity',
        // Simulate overlay wins the card tone while the ghost sits here (it's an
        // orthogonal overlay, not a lens — see useStudioSimulation).
        simGhost
          ? 'border-violet-500 ring-2 ring-violet-300 bg-violet-50'
          : focused
            ? 'border-blue-400 ring-2 ring-blue-200 bg-white'
            : gapErrors.length > 0
              ? 'border-rose-400 ring-2 ring-rose-200 bg-white'
              : gapWarnings.length > 0
                ? 'border-amber-400 ring-2 ring-amber-200 bg-white'
                : peopleGap
                  ? 'border-amber-300 border-dashed ring-1 ring-amber-200 bg-amber-50'
                  : heat
                    ? HEAT_TONE[heat.level]
                    : flowHeat
                      ? HEAT_TONE[flowHeat.level]
                      : 'border-slate-200 bg-white',
        // People lens dims uncovered nodes so staffed ones stand out.
        dimmed || (!!people && people.coverage === 0 && !peopleGap) ? 'opacity-40' : 'opacity-100',
      ].join(' ')}
    >
      {simGhost && (
        <span
          className="absolute -left-3 -top-3 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg ring-2 ring-white"
          title="Simulation ghost is here"
        >
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
        </span>
      )}
      {gaps.length > 0 && (
        <span
          className={[
            'absolute -left-2 -top-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white shadow',
            gapErrors.length > 0 ? 'bg-rose-600' : 'bg-amber-500',
          ].join(' ')}
          title={gaps.map((d) => d.message).join('\n')}
        >
          {gapErrors.length > 0 ? '✖' : '⚠'}
        </span>
      )}
      {live && live.total > 0 && (
        <span
          className={`absolute -right-2 -top-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-full ${heat ? HEAT_BADGE[heat.level] : 'bg-blue-600'} px-1.5 text-[11px] font-bold text-white shadow`}
          title={heat && heat.reasons.length > 0 ? heat.reasons.join(' · ') : `${live.total} in flight`}
        >
          {live.total}
        </span>
      )}
      {live && live.error > 0 && (
        <span
          className="absolute -left-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white shadow"
          title={`${live.error} item(s) parked in error — needs triage`}
        >
          !{live.error}
        </span>
      )}
      {flowHeat && (flow!.currentWip > 0 || flow!.runCount > 0) && (
        <span
          className={`absolute -right-2 -top-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-full ${HEAT_BADGE[flowHeat.level]} px-1.5 text-[11px] font-bold text-white shadow`}
          title={flowHeat.reasons.length > 0 ? flowHeat.reasons.join(' · ') : `${flow!.runCount} runs`}
        >
          {flow!.currentWip}
        </span>
      )}
      {people && people.station != null && (
        <span
          className={`absolute -right-2 -top-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-full ${
            people.coverage > 0 ? 'bg-violet-600' : 'bg-amber-500'
          } px-1.5 text-[11px] font-bold text-white shadow`}
          title={
            people.coverage > 0
              ? `${people.coverage} staff scoped to ${people.station}`
              : `No staff scoped to ${people.station} — coverage gap`
          }
        >
          {people.coverage > 0 ? people.coverage : '!'}
        </span>
      )}
      <Handle type="target" position={Position.Left} className="!bg-slate-300" />
      <div
        className="flex items-center gap-2 rounded-t-xl border-b border-slate-100 px-3 py-2"
        style={{ borderLeft: `4px solid ${accent}` }}
      >
        <NodeIcon name={node.meta?.icon} className="h-4 w-4 shrink-0 text-slate-500" />
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-slate-900">{node.meta?.label ?? node.type}</p>
          <p className="truncate font-mono text-[10px] text-slate-400">{node.type}</p>
        </div>
        {staticRole ? (
          <span
            className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATIC_ROLE[staticRole].pill}`}
          >
            {STATIC_ROLE[staticRole].label}
          </span>
        ) : (
          slaHours != null && (
            <span className="ml-auto shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              SLA {slaHours}h
            </span>
          )
        )}
      </div>
      {states.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 py-2">
          {states.map((key) => {
            const stage = workflowStage(key);
            return (
              <span
                key={key}
                className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${stage.badge}`}
                title={stage.description}
              >
                {circledNumber(stage.order)} {stage.label}
              </span>
            );
          })}
        </div>
      )}
      {station && (
        <div className="border-t border-slate-100 px-3 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: station.color }}>
            {station.label}
          </span>
        </div>
      )}
      {staticRole && staticDangling.length > 0 && (
        <div className="border-t border-slate-100 px-3 py-1.5">
          <span
            className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
            title={`Unwired output port(s): ${staticDangling.join(', ')} — data leaving here goes nowhere`}
          >
            ⚠ {staticDangling.length} unwired
          </span>
        </div>
      )}
      {live && live.total > 0 && (
        <div className="flex items-center gap-1 border-t border-slate-100 px-3 py-1.5">
          {Array.from({ length: Math.min(live.total, 8) }).map((_, i) => (
            <span
              key={i}
              className={`h-2 w-2 animate-pulse rounded-full ${heat ? HEAT_DOT[heat.level] : 'bg-blue-500'}`}
            />
          ))}
          {live.total > 8 && (
            <span className={`text-[10px] font-semibold ${heat ? HEAT_ACCENT[heat.level] : 'text-blue-600'}`}>
              +{live.total - 8}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            {live.blocked > 0 && (
              <span className="text-[10px] text-slate-400" title="Parked, awaiting a human/event">
                {live.blocked} parked
              </span>
            )}
            {ageHours != null && (
              <span
                className={`text-[10px] font-semibold tabular-nums ${heat ? HEAT_ACCENT[heat.level] : 'text-slate-400'}`}
                title={`Oldest item waiting ${formatAgeHours(ageHours)}${
                  slaHours != null
                    ? ` · SLA ${slaHours}h${heat?.slaRatio != null ? ` (${Math.round(heat.slaRatio * 100)}%)` : ''}`
                    : ''
                }`}
              >
                ⏱ {formatAgeHours(ageHours)}
              </span>
            )}
          </span>
        </div>
      )}
      {flow && (flow.currentWip > 0 || flow.runCount > 0 || (flow.dwellMedianS != null)) && (
        <div
          className={`flex items-center gap-2 border-t border-slate-100 px-3 py-1.5 ${
            flowHeat ? HEAT_ACCENT[flowHeat.level] : 'text-slate-500'
          }`}
        >
          <span
            className="text-[10px] font-semibold tabular-nums"
            title={`${flow.currentWip} in queue${
              flow.dwellMedianS != null
                ? ` · median dwell ${formatDuration(flow.dwellMedianS)}${
                    flow.dwellP90S != null ? ` · p90 ${formatDuration(flow.dwellP90S)}` : ''
                  }`
                : ''
            } · ${flow.runCount} runs`}
          >
            {flow.currentWip} WIP
            {flow.dwellMedianS != null && ` · ${formatDuration(flow.dwellMedianS)}`}
          </span>
          {flow.failRate != null && flow.failRate > 0 && (
            <span
              className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
              title={`${Math.round(flow.failRate * 100)}% of runs took a fail/error port`}
            >
              {Math.round(flow.failRate * 100)}% fail
            </span>
          )}
          {flow.wipTrend.length > 1 && (
            <span className="ml-auto flex h-4 items-end gap-px" title="WIP trend over the window">
              {(() => {
                const trend = flow.wipTrend;
                const peak = Math.max(1, ...trend.map((t) => t.queueDepth));
                return trend.slice(-10).map((t, i) => (
                  <span
                    key={`${t.date}-${i}`}
                    className={`w-0.5 rounded-sm ${flowHeat ? HEAT_DOT[flowHeat.level] : 'bg-slate-400'}`}
                    style={{ height: `${Math.max(8, (t.queueDepth / peak) * 100)}%` }}
                  />
                ));
              })()}
            </span>
          )}
        </div>
      )}
      {people && (
        <div className="flex items-center gap-1 border-t border-slate-100 px-3 py-1.5">
          {people.coverage > 0 ? (
            <>
              {people.staff.slice(0, 5).map((s) => (
                <span
                  key={s.id}
                  title={`${s.name}${s.role ? ` · ${s.role}` : ''}${s.isPrimary ? ' · primary' : ''}`}
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[8.5px] font-bold ${
                    s.isPrimary
                      ? 'bg-violet-600 text-white'
                      : 'bg-violet-100 text-violet-700 ring-1 ring-inset ring-violet-200'
                  }`}
                >
                  {staffInitials(s.name)}
                </span>
              ))}
              {people.coverage > 5 && (
                <span className="text-[10px] font-semibold text-violet-600">+{people.coverage - 5}</span>
              )}
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-violet-600">
                {people.station}
              </span>
            </>
          ) : (
            <span
              className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
              title={
                people.station
                  ? `No staff scoped to ${people.station} — assign coverage in the staff editor`
                  : 'No staff station maps to this step'
              }
            >
              ⚠ {people.station ? 'Uncovered' : 'No station'}
            </span>
          )}
        </div>
      )}
      {/* One source handle per declared output port — what makes conditional
          routing wireable. Unknown types fall back to a single handle. */}
      {(node.meta?.outputs?.length ?? 0) > 0 ? (
        node.meta!.outputs.map((port, i, all) => (
          <Handle
            key={port.id}
            id={port.id}
            type="source"
            position={Position.Right}
            style={{ top: `${((i + 1) / (all.length + 1)) * 100}%` }}
            className="!h-2.5 !w-2.5 !bg-slate-400"
            title={`port: ${port.id}`}
          />
        ))
      ) : (
        <Handle type="source" position={Position.Right} className="!bg-slate-400" />
      )}
    </div>
  );
}

export function DepartmentNode({ data }: NodeProps) {
  const d = data as DepartmentNodeData;
  return (
    <div className="relative w-52 cursor-zoom-in rounded-2xl border-2 bg-white px-4 py-3 shadow-sm" style={{ borderColor: d.color }}>
      <Handle type="target" position={Position.Left} className="!bg-slate-300" />
      {d.inFlight != null && d.inFlight > 0 && (
        <span className="absolute -right-2 -top-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-bold text-white shadow">
          {d.inFlight}
        </span>
      )}
      <p className="text-sm font-bold" style={{ color: d.color }}>
        {d.label}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {d.stepCount} step{d.stepCount === 1 ? '' : 's'} · {d.stepLabels.join(' · ')}
        {d.inFlight != null && <> · {d.inFlight} in flight</>}
      </p>
      <p className="mt-1 text-[10px] text-slate-300">double-click to expand</p>
      <Handle type="source" position={Position.Right} className="!bg-slate-400" />
    </div>
  );
}

// ─── Annotation (sticky-note) node (Phase E3) ────────────────
// A pure canvas decoration: no handles (it never wires into routing), an amber
// sticky tone, draggable in edit mode (React Flow position changes flow up via
// the canvas), inline-editable text + a delete affordance in edit mode, and
// read-only on the active version. Tones use already-generated amber shades to
// match the canvas's soft-decoration convention.
export function AnnotationNode({ data }: NodeProps) {
  const { annotation, editable, onUpdateText, onDelete } = data as AnnotationNodeData;
  return (
    <div className="group relative w-48 rounded-md border border-amber-300 bg-amber-50 p-2 shadow-sm ring-1 ring-amber-200/60">
      {editable && (
        <button
          type="button"
          // nodrag/nopan keep the click from starting a canvas drag/pan.
          className="nodrag nopan absolute -right-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 text-amber-800 opacity-0 shadow transition-opacity hover:bg-amber-300 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(annotation.id);
          }}
          title="Delete note"
          aria-label="Delete note"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {editable ? (
        <textarea
          // nodrag so typing/selecting inside the note doesn't drag the node.
          className="nodrag nopan w-full resize-none border-0 bg-transparent text-[11px] leading-snug text-amber-900 placeholder:text-amber-400 focus:outline-none"
          rows={3}
          value={annotation.text}
          placeholder="Add a note…"
          onChange={(e) => onUpdateText?.(annotation.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words text-[11px] leading-snug text-amber-900">
          {annotation.text || <span className="italic text-amber-400">Empty note</span>}
        </p>
      )}
    </div>
  );
}

export const NODE_TYPES = { process: ProcessNode, department: DepartmentNode, annotation: AnnotationNode };
