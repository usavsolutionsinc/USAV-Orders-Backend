import { useMemo, useState } from 'react';
import { Stat } from './AuditPrimitives';
import { TimelineList } from './EventTimeline';
import { CartonsList } from './CartonsList';
import { LinesList } from './LinesList';
import type { PODetail } from './audit-receiving-types';

/** The selected PO: header stats + workflow chips + Timeline/Packages/Lines tabs. */
export function PODetailView({ detail }: { detail: PODetail }) {
  const { po, cartons, lines, events } = detail;
  const [activeTab, setActiveTab] = useState<'timeline' | 'cartons' | 'lines'>('timeline');

  const totals = useMemo(() => {
    const expected = lines.reduce((s, l) => s + (l.quantity_expected ?? 0), 0);
    const received = lines.reduce((s, l) => s + (l.quantity_received ?? 0), 0);
    const byStatus: Record<string, number> = {};
    for (const l of lines) byStatus[l.workflow_status] = (byStatus[l.workflow_status] ?? 0) + 1;
    return { expected, received, byStatus };
  }, [lines]);

  return (
    <div className="px-6 py-5">
      <header className="flex items-start justify-between gap-4 border-b border-border-soft pb-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-emerald-600">Purchase Order</div>
          <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-text-default">{po.po_number ?? po.po_id}</h2>
          {po.vendor_name && <div className="text-sm text-text-soft">{po.vendor_name}</div>}
          <div className="mt-1 text-caption text-text-faint">
            Zoho PO id: <code className="font-mono">{po.po_id}</code>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right">
          <Stat label="Packages" value={cartons.length} />
          <Stat label="Lines" value={lines.length} />
          <Stat label="Received / Expected" value={`${totals.received} / ${totals.expected}`} />
        </div>
      </header>

      {Object.keys(totals.byStatus).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(totals.byStatus).map(([status, n]) => (
            <span key={status} className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-caption font-medium text-text-muted">
              <span className="font-semibold">{n}</span>
              <span className="text-text-soft">{status}</span>
            </span>
          ))}
        </div>
      )}

      <nav className="mt-5 flex gap-1 border-b border-border-soft">
        {([
          ['timeline', `Timeline (${events.length})`],
          ['cartons', `Packages (${cartons.length})`],
          ['lines', `Lines (${lines.length})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`ds-raw-button -mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              activeTab === key ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-text-soft hover:text-text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="mt-4">
        {activeTab === 'timeline' && <TimelineList events={events} />}
        {activeTab === 'cartons' && <CartonsList cartons={cartons} />}
        {activeTab === 'lines' && <LinesList lines={lines} events={events} />}
      </div>
    </div>
  );
}
