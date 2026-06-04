'use client';

/**
 * OperationsSidebarPanel — the reference map beside the Operations flow board.
 *
 * Three lenses on the same system, driven by the operations-catalog:
 *   Flows       — receiving / shipping / FBA / repair / returns, step by step
 *   Stations    — RECEIVING / TECH / PACK / LABELS / FBA / ADMIN + what they do
 *   Identifiers — tracking #, serial #, Zoho SKU, order #, FNSKU, shipment id…
 *                 with where each lives and how it travels through the system
 *
 * Selecting any item writes `?ops=<key>` to the URL; the flow board reads it to
 * spotlight that item's path. Cross-links (a station's identifiers, an
 * identifier's relations) jump between entries so you can trace information.
 */

import { useMemo, useState } from 'react';
import { AdminSidebarShell, useAdminUrlState } from '@/components/admin/shared';
import {
  FLOWS,
  STATIONS,
  IDENTIFIERS,
  findCatalogItem,
  type OpsFlow,
  type OpsStation,
  type OpsIdentifier,
} from './operations-catalog';

type Lens = 'all' | 'flow' | 'station' | 'identifier';

const LENSES: ReadonlyArray<{ value: Lens; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'flow', label: 'Flows' },
  { value: 'station', label: 'Stations' },
  { value: 'identifier', label: 'Info' },
];

export function OperationsSidebarPanel() {
  const { searchParams, setParam } = useAdminUrlState();
  const selected = searchParams.get('ops');
  const [lens, setLens] = useState<Lens>('all');
  const [query, setQuery] = useState('');

  const select = (key: string) =>
    setParam((p) => {
      if (p.get('ops') === key) p.delete('ops');
      else p.set('ops', key);
    });

  // Jump to a cross-linked entry: open it and make sure its lens is visible.
  const jumpTo = (key: string) => {
    const hit = findCatalogItem(key);
    if (hit) setLens('all');
    setParam((p) => p.set('ops', key));
  };

  const q = query.trim().toLowerCase();
  const match = (text: string) => !q || text.toLowerCase().includes(q);

  const flows = useMemo(
    () => FLOWS.filter((f) => match(`${f.label} ${f.blurb} ${f.states.join(' ')}`)),
    [q],
  );
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
        placeholder: 'Search stations, info, flows',
        variant: 'blue',
      }}
      filters={<FilterChips value={lens} onChange={setLens} />}
      stats={
        <p className="text-micro font-bold uppercase tracking-wider text-gray-500">
          {STATIONS.length} stations · {IDENTIFIERS.length} identifiers · {FLOWS.length} flows
        </p>
      }
    >
      <div className="space-y-4 px-1">
        {show('flow') && flows.length > 0 && (
          <Group title="Flows">
            {flows.map((f) => (
              <FlowRow key={f.key} flow={f} open={selected === f.key} onToggle={() => select(f.key)} onJump={jumpTo} />
            ))}
          </Group>
        )}

        {show('station') && stations.length > 0 && (
          <Group title="Stations">
            {stations.map((s) => (
              <StationRow key={s.key} station={s} open={selected === s.key} onToggle={() => select(s.key)} onJump={jumpTo} />
            ))}
          </Group>
        )}

        {show('identifier') && identifiers.length > 0 && (
          <Group title="Identifiers — how information travels">
            {identifiers.map((i) => (
              <IdentifierRow key={i.key} id={i} open={selected === i.key} onToggle={() => select(i.key)} onJump={jumpTo} />
            ))}
          </Group>
        )}

        {flows.length === 0 && stations.length === 0 && identifiers.length === 0 && (
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
  const cls = `inline-block rounded-md border px-1.5 py-0.5 text-[10px] ${
    mono ? 'font-mono' : 'font-medium'
  } ${onClick ? 'cursor-pointer border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100' : 'border-gray-200 bg-gray-50 text-gray-600'}`;
  return onClick ? (
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
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-gray-50">
        <Dot color={color} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-gray-900">{title}</span>
          {subtitle ? <span className="block truncate text-[11px] text-gray-500">{subtitle}</span> : null}
        </span>
        <span className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open ? <div className="space-y-2.5 border-t border-gray-200 px-2.5 py-2.5 text-[12px] text-gray-700">{children}</div> : null}
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

function FlowRow({ flow, open, onToggle, onJump }: { flow: OpsFlow; open: boolean; onToggle: () => void; onJump: (k: string) => void }) {
  return (
    <RowShell color={flow.color} title={flow.label} subtitle={flow.blurb} open={open} onToggle={onToggle}>
      <DetailBlock label="Stations">
        {flow.stations.map((s) => (
          <Chip key={s} label={s} onClick={() => onJump(s)} />
        ))}
      </DetailBlock>
      <div>
        <p className="mb-1 text-micro font-bold uppercase tracking-wider text-gray-400">Path</p>
        <ol className="space-y-1">
          {flow.steps.map((step, idx) => (
            <li key={`${step.state}-${idx}`} className="flex items-start gap-2">
              <span className="mt-0.5 w-5 shrink-0 text-right text-[10px] font-bold text-gray-400">{idx + 1}</span>
              <span>
                <span className="font-mono text-[11px] font-semibold text-gray-800">{step.state}</span>
                <span className="text-gray-400"> · {step.station}</span>
                <span className="block text-[11px] text-gray-500">{step.note}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </RowShell>
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
              <span className="font-mono text-[11px] font-semibold text-gray-800">{t.station}</span>
              <span className="text-[11px] text-gray-500">{t.note}</span>
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
