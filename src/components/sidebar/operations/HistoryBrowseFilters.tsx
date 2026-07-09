'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useStaffFilter } from '@/hooks/useStaffFilter';
import { useOperationsSavedViews } from '@/hooks/useOperationsSavedViews';
import { JOURNEY_SOURCES, type JourneySource } from '@/lib/operations/journey-helpers';
import {
  SYSTEM_SAVED_VIEWS,
  systemViewParam,
} from '@/lib/operations/saved-view-presets';
import {
  JOURNEY_STATION_ITEMS,
  JOURNEY_TYPE_ITEMS,
} from './operations-sidebar-shared';
import type { OperationsTimelineUrlState } from './useOperationsTimelineUrlState';

/**
 * The Operations → History BROWSE filter panel (plan Phase 3). Renders the
 * saved-view presets + station / type / source / date / staff refinements as
 * house-style chips, each driving a setter on the URL-state hook (Monitor: all
 * filter state lives in the URL). Shown only when the browse feed is active.
 *
 * The `audit` source spine is admin-only (`admin.view_logs`, plan §3.2 Option
 * B), so its chip is hidden for non-admins — the server also enforces this.
 */

const SOURCE_LABELS: Record<JourneySource, string> = {
  sal: 'Scans',
  inventory: 'Lifecycle',
  audit: 'Audit',
  carrier: 'Carrier',
  warranty: 'Warranty',
};

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

type DatePreset = 'all' | 'today' | '7d' | '30d' | 'custom';

function activeDatePreset(from: string): DatePreset {
  if (!from) return 'all';
  const f = dayKey(from);
  if (f === dayKey(startOfTodayISO())) return 'today';
  if (f === dayKey(daysAgoISO(7))) return '7d';
  if (f === dayKey(daysAgoISO(30))) return '30d';
  return 'custom';
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-eyebrow font-black uppercase tracking-widest transition ${
        active
          ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-400'
          : 'bg-surface-sunken text-text-muted hover:bg-surface-strong'
      }`}
    >
      {children}
    </button>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-eyebrow font-black uppercase tracking-widest text-text-faint">{label}</p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

export function HistoryBrowseFilters({ url }: { url: OperationsTimelineUrlState }) {
  const { user } = useAuth();
  const canViewAudit = user?.permissions?.includes('admin.view_logs') ?? false;
  const { options: staffOptions } = useStaffFilter();
  const { views: userViews, create, creating } = useOperationsSavedViews();

  const datePreset = activeDatePreset(url.from);
  const sourceItems = JOURNEY_SOURCES.filter((s) => s !== 'audit' || canViewAudit);

  const saveCurrent = () => {
    const name = typeof window !== 'undefined' ? window.prompt('Name this view')?.trim() : '';
    if (!name) return;
    create({ name, filters: url.filters });
  };

  return (
    <div className="space-y-3 px-3 pb-3">
      <Section label="Views">
        {SYSTEM_SAVED_VIEWS.map((v) => (
          <Chip
            key={v.id}
            active={url.view === systemViewParam(v.id)}
            onClick={() => url.applyView(v.filters, systemViewParam(v.id))}
          >
            {v.name}
          </Chip>
        ))}
        {userViews.map((v) => (
          <Chip
            key={v.id}
            active={url.view === String(v.id)}
            onClick={() => url.applyView(v.filters, String(v.id))}
          >
            {v.name}
          </Chip>
        ))}
      </Section>

      <Section label="Station">
        {JOURNEY_STATION_ITEMS.map((s) => (
          <Chip
            key={s.id}
            active={url.stations.includes(s.id)}
            onClick={() => url.toggleStation(s.id)}
          >
            {s.label}
          </Chip>
        ))}
      </Section>

      <Section label="Event">
        {JOURNEY_TYPE_ITEMS.map((t) => (
          <Chip key={t.id} active={url.types.includes(t.id)} onClick={() => url.toggleType(t.id)}>
            {t.label}
          </Chip>
        ))}
      </Section>

      <Section label="Source">
        {sourceItems.map((s) => (
          <Chip key={s} active={url.sources.includes(s)} onClick={() => url.toggleSource(s)}>
            {SOURCE_LABELS[s]}
          </Chip>
        ))}
      </Section>

      <Section label="When">
        <Chip active={datePreset === 'all'} onClick={() => url.setRange(null, null)}>
          All
        </Chip>
        <Chip active={datePreset === 'today'} onClick={() => url.setRange(startOfTodayISO(), null)}>
          Today
        </Chip>
        <Chip active={datePreset === '7d'} onClick={() => url.setRange(daysAgoISO(7), null)}>
          7d
        </Chip>
        <Chip active={datePreset === '30d'} onClick={() => url.setRange(daysAgoISO(30), null)}>
          30d
        </Chip>
      </Section>

      <div className="space-y-1.5">
        <p className="text-eyebrow font-black uppercase tracking-widest text-text-faint">Staff</p>
        <select
          value={url.staffId}
          onChange={(e) => url.setStaffId(e.target.value || null)}
          className="h-8 w-full rounded-md border border-border-soft bg-surface-card px-2 text-caption text-text-default outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          aria-label="Filter by staff"
        >
          <option value="">All staff</option>
          {staffOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between border-t border-border-hairline pt-2">
        <span className="text-eyebrow font-bold uppercase tracking-widest text-text-faint">
          {url.activeFilterCount
            ? `${url.activeFilterCount} filter${url.activeFilterCount === 1 ? '' : 's'}`
            : 'No filters'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={saveCurrent}
            disabled={creating || url.activeFilterCount === 0}
            className="text-eyebrow font-black uppercase tracking-widest text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-text-faint"
          >
            Save view
          </button>
          {url.activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={() => url.clearFilters()}
              className="text-eyebrow font-black uppercase tracking-widest text-text-faint hover:text-text-muted"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
