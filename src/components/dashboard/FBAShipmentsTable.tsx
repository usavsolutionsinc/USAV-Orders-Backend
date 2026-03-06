'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from '@/components/Icons';
import { formatDateTimePST } from '@/lib/timezone';

interface FBAShipmentRow {
  id: number;
  tracking: string;
  carrier: string | null;
  qa_status: string | null;
  disposition_code: string | null;
  condition_grade: string | null;
  target_channel: string | null;
  needs_test: boolean;
  assigned_tech_id: number | null;
  assigned_tech_name: string | null;
  received_at: string | null;
}

async function fetchFbaShipments(): Promise<FBAShipmentRow[]> {
  const res = await fetch('/api/dashboard/fba-shipments?limit=500', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch FBA shipments');
  const data = await res.json();
  return Array.isArray(data?.rows) ? data.rows : [];
}

function enumLabel(value: string | null | undefined) {
  return String(value || '').replaceAll('_', ' ') || '-';
}

export default function FBAShipmentsTable() {
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['dashboard-fba-shipments'],
    queryFn: fetchFbaShipments,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <p className="text-sm font-black uppercase tracking-widest text-red-600">Failed to load FBA shipments</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-gray-200 bg-purple-50 px-6 py-4">
        <h2 className="text-[18px] font-black uppercase tracking-tight text-purple-900">FBA Shipments</h2>
        <p className="mt-1 text-[10px] font-black uppercase tracking-[0.2em] text-purple-500">Receiving Queue - {data.length} rows</p>
      </div>
      <div className="flex-1 overflow-auto">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">No FBA shipment rows</p>
          </div>
        ) : (
          <table className="min-w-full border-collapse">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-200 text-left text-[10px] font-black uppercase tracking-widest text-gray-500">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Tracking</th>
                <th className="px-3 py-2">Carrier</th>
                <th className="px-3 py-2">Condition</th>
                <th className="px-3 py-2">QA</th>
                <th className="px-3 py-2">Disposition</th>
                <th className="px-3 py-2">Needs Test</th>
                <th className="px-3 py-2">Assigned Tech</th>
                <th className="px-3 py-2">Received At</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 text-[11px] font-bold text-gray-700 hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono">{row.id}</td>
                  <td className="px-3 py-2 font-mono text-purple-700">{row.tracking || '-'}</td>
                  <td className="px-3 py-2">{row.carrier || '-'}</td>
                  <td className="px-3 py-2">{enumLabel(row.condition_grade)}</td>
                  <td className="px-3 py-2">{enumLabel(row.qa_status)}</td>
                  <td className="px-3 py-2">{enumLabel(row.disposition_code)}</td>
                  <td className="px-3 py-2">{row.needs_test ? 'YES' : 'NO'}</td>
                  <td className="px-3 py-2">{row.assigned_tech_name || (row.assigned_tech_id ? `#${row.assigned_tech_id}` : '-')}</td>
                  <td className="px-3 py-2">{row.received_at ? formatDateTimePST(row.received_at) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
