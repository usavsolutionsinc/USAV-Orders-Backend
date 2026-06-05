import { sectionLabel } from '@/design-system/tokens/typography/presets';
import type { SummaryTotals } from './types';

function SummaryCell({ label, value, tone = 'gray' }: { label: string; value: number; tone?: 'gray' | 'emerald' }) {
  const valueClass = tone === 'emerald' ? 'text-emerald-700' : 'text-gray-900';
  return (
    <div className="border border-gray-200 bg-white px-3 py-2.5">
      <p className={sectionLabel}>{label}</p>
      <p className={`mt-1 text-xl font-black tracking-tight ${valueClass}`}>{value}</p>
    </div>
  );
}

export function StaffSummaryCells({ summary }: { summary: SummaryTotals }) {
  return (
    <div className="mb-4 grid gap-2 sm:grid-cols-5">
      <SummaryCell label="Shown" value={summary.total} />
      <SummaryCell label="Active" value={summary.active} />
      <SummaryCell label="Technicians" value={summary.technicians} />
      <SummaryCell label="Packers" value={summary.packers} />
      <SummaryCell label="Scheduled Today" value={summary.presentToday} tone="emerald" />
    </div>
  );
}
