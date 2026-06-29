'use client';

/**
 * OperationsSidebarPanel — the reference map beside the Operations flows panel.
 *
 * Two lenses on the system, as a read-only reference:
 *   Stations    — RECEIVING / TECH / PACK / LABELS / FBA / ADMIN + what they do
 *   Identifiers — tracking #, serial #, Zoho SKU, order #, FNSKU, shipment id…
 *                 with where each lives and how it travels through the system
 *
 * Flows live in the main panel now (OperationsFlowsDisplay), shown in full as a
 * descriptive display rather than as sidebar dropdowns. Cross-links between a
 * station and the identifiers it handles still jump within the sidebar so you
 * can trace a piece of information; the canvas spotlight is a later phase.
 */

import { useMemo, useState } from 'react';
import { AdminSidebarShell } from '@/components/admin/shared';
import {
  STATIONS,
  IDENTIFIERS,
  type OpsStation,
  type OpsIdentifier,
} from './operations-catalog';

type Lens = 'all' | 'station' | 'identifier';

const LENSES: ReadonlyArray<{ value: Lens; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'station', label: 'Stations' },
  { value: 'identifier', label: 'Info' },
];

export function OperationsSidebarPanel() {
  const [selected, setSelected] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>('all');
  const [query, setQuery] = useState('');

  const toggle = (key: string) => setSelected((cur) => (cur === key ? null : key));
  const jumpTo = (key: string) => {
    setLens('all');
    setSelected(key);
  };

  const q = query.trim().toLowerCase();
  const match = (text: string) => !q || text.toLowerCase().includes(q);

  const stations = useMemo(
    () => STATIONS.filter((s) => match(`${s.label} ${s.blurb} ${s.activityTypes.join(' ')}`)),
    [q],
  );
  const identifiers = useMemo(
    () => IDENTIFIERS.filter((i) => match(`${i.label} ${i.blurb} ${i.example} ${i.tables.join(' ')}`)),
    [q],
  );

  const show = (l: Lens) => lens === 'all' || lens === l;

  return (
    <AdminSidebarShell
      search={{
        value: query,
        onChange: setQuery,
        onClear: () => setQuery(''),
        placeholder: 'Search stations & info',
        variant: 'blue',
      }}
      filters={<FilterChips value={lens} onChange={setLens} />}
      stats={
        <p className="text-micro font-bold uppercase tracking-wider text-gray-500">
          {STATIONS.length} stations · {IDENTIFIERS.length} identifiers
        </p>
      }
    >
      <div className="space-y-4 px-1">
        {show('station') && stations.length > 0 && (
          <Group title="Stations">
            {stations.map((s) => (
              <StationRow key={s.key} station={s} open={selected === s.key} onToggle={() => toggle(s.key)} onJump={jumpTo} />
            ))}
          </Group>
        )}

        {show('identifier') && identifiers.length > 0 && (
          <Group title="Identifiers — how information travels">
            {identifiers.map((i) => (
              <IdentifierRow key={i.key} id={i} open={selected === i.key} onToggle={() => toggle(i.key)} onJump={jumpTo} />
            ))}
          </Group>
        )}

        {stations.length === 0 && identifiers.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-gray-400">No matches.</p>
        )}
      </div>
    </AdminSidebarShell>
  );
}

// ─── Local presentational pieces ─────────────────────────────

function FilterChips({ value, onChange }: { value: Lens; onChange: (l: Lens) => void }) {
  return (
    <>
      {LENSES.map((opt) => (
        // ds-raw-button: segmented lens toggle with custom active fill (bg-blue-600)
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 rounded-lg px-2 py-1 text-micro font-bold uppercase tracking-wider transition ${
            value === opt.value
              ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 px-2 text-micro font-bold uppercase tracking-wider text-gray-400">{title}</h3>
      <ul className="space-y-1">{children}</ul>
    </section>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

function Chip({ label, onClick, mono }: { label: string; onClick?: () => void; mono?: boolean }) {
  const cls = `inline-block rounded-md border px-1.5 py-0.5 text-micro ${
    mono ? 'font-mono' : 'font-medium'
  } ${onClick ? 'cursor-pointer border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100' : 'border-gray-200 bg-gray-50 text-gray-600'}`;
  return onClick ? (
    // ds-raw-button: clickable chip badge sharing styling with the non-button span branch
    <button type="button" onClick={onClick} className={cls}>
      {label}
    </button>
  ) : (
    <span className={cls}>{label}</span>
  );
}

function RowShell({
  color,
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  color: string;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <li className={`overflow-hidden rounded-lg border ${open ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 bg-white'}`}>
      {/* ds-raw-button: full-width left-aligned accordion header (multi-line title/subtitle + chevron) */}
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-gray-50">
        <Dot color={color} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-gray-900">{title}</span>
          {subtitle ? <span className="block truncate text-caption text-gray-500">{subtitle}</span> : null}
        </span>
        <span className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open ? <div className="space-y-2.5 border-t border-gray-200 px-2.5 py-2.5 text-label text-gray-700">{children}</div> : null}
    </li>
  );
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-micro font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function StationRow({ station, open, onToggle, onJump }: { station: OpsStation; open: boolean; onToggle: () => void; onJump: (k: string) => void }) {
  return (
    <RowShell color={station.color} title={station.label} subtitle={station.blurb} open={open} onToggle={onToggle}>
      {station.activityTypes.length > 0 && (
        <DetailBlock label="Activity types">
          {station.activityTypes.map((a) => (
            <Chip key={a} label={a} mono />
          ))}
        </DetailBlock>
      )}
      <DetailBlock label="Handles">
        {station.handles.map((h) => {
          const id = IDENTIFIERS.find((i) => i.key === h);
          return <Chip key={h} label={id?.label ?? h} onClick={() => onJump(h)} />;
        })}
      </DetailBlock>
      <DetailBlock label="Lifecycle states">
        {station.states.map((s) => (
          <Chip key={s} label={s} mono />
        ))}
      </DetailBlock>
    </RowShell>
  );
}

function IdentifierRow({ id, open, onToggle, onJump }: { id: OpsIdentifier; open: boolean; onToggle: () => void; onJump: (k: string) => void }) {
  return (
    <RowShell color="#0ea5e9" title={id.label} subtitle={id.example} open={open} onToggle={onToggle}>
      <p className="text-gray-600">{id.blurb}</p>
      <DetailBlock label="Lives in">
        {id.tables.map((t) => (
          <Chip key={t} label={t} mono />
        ))}
      </DetailBlock>
      <div>
        <p className="mb-1 text-micro font-bold uppercase tracking-wider text-gray-400">Travels through</p>
        <ul className="space-y-1">
          {id.travels.map((t, idx) => (
            <li key={`${t.station}-${idx}`} className="flex items-start gap-2">
              <span className="font-mono text-caption font-semibold text-gray-800">{t.station}</span>
              <span className="text-caption text-gray-500">{t.note}</span>
            </li>
          ))}
        </ul>
      </div>
      {id.relatedTo.length > 0 && (
        <DetailBlock label="Linked to">
          {id.relatedTo.map((r) => {
            const other = IDENTIFIERS.find((i) => i.key === r);
            return <Chip key={r} label={other?.label ?? r} onClick={() => onJump(r)} />;
          })}
        </DetailBlock>
      )}
    </RowShell>
  );
}
