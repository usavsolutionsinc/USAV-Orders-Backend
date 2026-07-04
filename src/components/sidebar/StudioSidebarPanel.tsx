'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import {
  Activity,
  AlertTriangle,
  Boxes,
  ChevronDown,
  Layers,
  MapPin,
  Share2,
  TrendingUp,
  User,
  Wrench,
} from '@/components/Icons';
import { useStudioWorkspace } from '@/components/studio/StudioWorkspaceContext';
import { StudioLibrary } from '@/components/studio/StudioLibrary';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { cn } from '@/utils/_cn';

/**
 * Contextual sidebar for /studio (Operations Studio) — the route's whole
 * left chrome lives here so the page body is a full-width canvas.
 *
 *   View dropdown (lens · zoom)  →  node Library  →  Issues rail
 *
 * State comes from StudioWorkspaceContext (shared with the canvas in
 * StudioShell), so the Library and Issues reflect the exact same graph/draft
 * the canvas is painting. The View dropdown drives the shell purely through
 * the URL params it already reads (`?lens=`, `?z=`).
 */

type IconCmp = (props: { className?: string }) => JSX.Element;

const LENSES: ReadonlyArray<{ id: string; label: string; icon: IconCmp; detail: string }> = [
  { id: 'build', label: 'Build', icon: Wrench, detail: 'Wire & configure the operation graph' },
  { id: 'static', label: 'Static', icon: Share2, detail: 'Where data flows — sources → transforms → sinks' },
  { id: 'live', label: 'Live', icon: Activity, detail: 'Units in flight, heat & edge traffic, real time' },
  { id: 'flow', label: 'Flow²', icon: TrendingUp, detail: 'Throughput, dwell & bottlenecks over the window' },
  { id: 'people', label: 'People', icon: User, detail: 'Who staffs each step — coverage & gaps (read-only)' },
  { id: 'gaps', label: 'Gaps', icon: AlertTriangle, detail: 'Diagnostics — what blocks a clean publish' },
];

const ZOOMS: ReadonlyArray<{ z: string; label: string; icon: IconCmp; detail: string }> = [
  { z: '0', label: 'L0 · Business map', icon: Boxes, detail: 'Departments at a glance' },
  { z: '1', label: 'L1 · Flow graph', icon: MapPin, detail: 'Process steps & numbered states' },
  { z: '2', label: 'L2 · Station', icon: Layers, detail: 'A single step’s station — pick a node to inspect' },
];

export function StudioSidebarPanel() {
  const { has, isLoaded } = useAuth();
  const {
    lens,
    z,
    editing,
    palette,
    diagnostics,
    onAddNode,
    setParams,
    templates,
    canManage,
    importingTemplateId,
    importTemplate,
  } = useStudioWorkspace();
  const [open, setOpen] = useState(false);

  if (isLoaded && !has('studio.view')) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-caption font-semibold text-text-soft">
        Requires the “View Operations Studio” permission.
      </div>
    );
  }

  const activeLens = LENSES.find((l) => l.id === lens) ?? LENSES[0];
  const activeZoomLabel = z === 0 ? 'L0 · Map' : z === 2 ? 'L2 · Station' : 'L1 · Flow';
  const ActiveLensIcon = activeLens.icon;

  const go = (patch: Record<string, string | null>) => {
    setParams(patch);
    setOpen(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-card">
      {/* No own header — the master-nav already renders the "Studio" route title. */}

      {/* ─── Combined View dropdown (lens · zoom) ─── */}
      <div className={`relative shrink-0 border-b border-border-hairline ${SIDEBAR_GUTTER} py-2.5`}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'ds-raw-button flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
            open ? 'border-blue-300 bg-blue-50' : 'border-border-soft bg-surface-card hover:bg-surface-hover',
          )}
        >
          <ActiveLensIcon className="h-4 w-4 shrink-0 text-blue-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-text-default">
              {activeLens.label} · {activeZoomLabel}
            </span>
            <span className="block text-caption text-text-soft">Lens &amp; zoom</span>
          </span>
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 text-text-faint transition-transform', open && 'rotate-180')}
          />
        </button>

        {open && (
          <>
            {/* click-away catcher */}
            <button
              type="button"
              aria-label="Close view menu"
              onClick={() => setOpen(false)}
              className="ds-raw-button fixed inset-0 z-panelPopover cursor-default"
            />
            <div
              role="menu"
              className={`absolute left-0 right-0 z-panelPopover mt-1 ${SIDEBAR_GUTTER} `}
            >
              <div className="rounded-xl border border-border-soft bg-surface-card p-2 shadow-xl">
                <p className="mb-1 px-1 text-micro font-bold uppercase tracking-wider text-text-faint">Lenses</p>
                <div className="space-y-0.5">
                  {LENSES.map((l) => {
                    const disabled = editing && l.id === 'live';
                    return (
                      <Row
                        key={l.id}
                        icon={l.icon}
                        label={l.label}
                        detail={l.detail}
                        active={activeLens.id === l.id}
                        disabled={disabled}
                        disabledHint={disabled ? 'Drafts have no live traffic' : undefined}
                        onClick={() => go({ lens: l.id === 'build' ? null : l.id })}
                      />
                    );
                  })}
                </div>

                <p className="mb-1 mt-2 px-1 text-micro font-bold uppercase tracking-wider text-text-faint">Zoom</p>
                <div className="space-y-0.5">
                  {ZOOMS.map((zoom) => (
                    <Row
                      key={zoom.z}
                      icon={zoom.icon}
                      label={zoom.label}
                      detail={zoom.detail}
                      active={String(z) === zoom.z}
                      onClick={() => go({ z: zoom.z === '1' ? null : zoom.z, focus: null })}
                    />
                  ))}
                </div>
                <p className="mt-1.5 px-1 text-micro leading-relaxed text-text-faint">
                  Double-click a step at L1 to open its station detail (L2).
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ─── Library + Issues — same graph/draft the canvas paints ─── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <StudioLibrary
          palette={palette}
          diagnostics={diagnostics}
          editable={editing}
          onAddNode={onAddNode}
          onFocusIssue={(nodeId) => setParams({ focus: nodeId, z: '1', lens: 'gaps' })}
          templates={templates}
          canManage={canManage}
          importingTemplateId={importingTemplateId}
          onImportTemplate={importTemplate}
        />
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  detail,
  active,
  disabled,
  disabledHint,
  onClick,
}: {
  icon: IconCmp;
  label: string;
  detail: string;
  active: boolean;
  disabled?: boolean;
  disabledHint?: string;
  onClick: () => void;
}) {
  const el = (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'ds-raw-button flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
        disabled
          ? 'cursor-not-allowed opacity-40'
          : active
            ? 'bg-blue-50 text-blue-700'
            : 'text-text-muted hover:bg-surface-hover',
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-blue-600' : 'text-text-faint')} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-caption text-text-soft">{detail}</span>
      </span>
      {active && <span className="mt-0.5 shrink-0 text-xs font-bold text-blue-600">✓</span>}
    </button>
  );
  return disabledHint ? (
    <HoverTooltip label={disabledHint} asChild>
      {el}
    </HoverTooltip>
  ) : el;
}
