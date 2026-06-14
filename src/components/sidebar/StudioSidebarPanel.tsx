'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { Activity, AlertTriangle, Boxes, Layers, MapPin, Share2, Wrench } from '@/components/Icons';
import { cn } from '@/utils/_cn';

/**
 * Contextual sidebar for /studio (Operations Studio). The canvas, Library and
 * Inspector live in the main pane (StudioShell); this panel is the master-nav
 * body for the route — an orientation + quick-jump that drives the shell purely
 * through the URL params it already reads (`?lens=`, `?z=`), so the two stay
 * decoupled (no shared state). Mirrors the other route panels' shape.
 */

const LENSES = [
  { id: 'build', label: 'Build', icon: Wrench, detail: 'Wire & configure the operation graph' },
  { id: 'static', label: 'Static', icon: Share2, detail: 'Where data flows — sources → transforms → sinks' },
  { id: 'live', label: 'Live', icon: Activity, detail: 'Units in flight, heat & edge traffic, real time' },
  { id: 'gaps', label: 'Gaps', icon: AlertTriangle, detail: 'Diagnostics — what blocks a clean publish' },
] as const;

const ZOOMS = [
  { z: '0', label: 'L0 · Business map', icon: Boxes, detail: 'Departments at a glance' },
  { z: '1', label: 'L1 · Flow graph', icon: MapPin, detail: 'Process steps & numbered states' },
] as const;

export function StudioSidebarPanel() {
  const { has, isLoaded } = useAuth();
  const searchParams = useSearchParams();

  if (isLoaded && !has('studio.view')) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-caption font-semibold text-gray-500">
        Requires the “View Operations Studio” permission.
      </div>
    );
  }

  const lensRaw = searchParams.get('lens');
  const activeLens =
    lensRaw === 'live' || lensRaw === 'gaps' || lensRaw === 'static' ? lensRaw : 'build';
  const zRaw = searchParams.get('z');
  const activeZoom = zRaw === '0' ? '0' : zRaw === '2' ? '2' : '1';

  // Merge a param delta onto the current query, returning a /studio href.
  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `/studio?${qs}` : '/studio';
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className={`flex shrink-0 items-center gap-2 border-b border-gray-100 ${SIDEBAR_GUTTER} py-2.5`}>
        <Layers className="h-4 w-4 text-blue-600" />
        <p className={`${sectionLabel} text-blue-600`}>Studio</p>
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto ${SIDEBAR_GUTTER} py-3`}>
        <p className="mb-3 px-1 text-caption leading-relaxed text-gray-500">
          Build, observe and diagnose the whole operation on one canvas. Switch how the
          graph is painted with a lens; drill from the business map down into each step.
        </p>

        <section className="mb-4">
          <p className="mb-1.5 px-1 text-micro font-bold uppercase tracking-wider text-gray-400">Lenses</p>
          <div className="space-y-0.5">
            {LENSES.map((l) => (
              <Row
                key={l.id}
                href={href({ lens: l.id === 'build' ? null : l.id })}
                active={activeLens === l.id}
                icon={l.icon}
                label={l.label}
                detail={l.detail}
              />
            ))}
          </div>
        </section>

        <section>
          <p className="mb-1.5 px-1 text-micro font-bold uppercase tracking-wider text-gray-400">Zoom</p>
          <div className="space-y-0.5">
            {ZOOMS.map((zoom) => (
              <Row
                key={zoom.z}
                href={href({ z: zoom.z === '1' ? null : zoom.z, focus: null })}
                active={activeZoom === zoom.z}
                icon={zoom.icon}
                label={zoom.label}
                detail={zoom.detail}
              />
            ))}
          </div>
          <p className="mt-2 px-1 text-micro leading-relaxed text-gray-400">
            Double-click a step at L1 to open its station detail (L2).
          </p>
        </section>
      </div>
    </div>
  );
}

function Row({
  href,
  active,
  icon: Icon,
  label,
  detail,
}: {
  href: string;
  active: boolean;
  icon: (props: { className?: string }) => JSX.Element;
  label: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      replace
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors',
        active ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50',
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-blue-600' : 'text-gray-400')} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-caption text-gray-500">{detail}</span>
      </span>
    </Link>
  );
}
