import { sectionLabel } from '@/design-system/tokens/typography/presets';
import type { StaffRole } from './constants';

export function BulkScheduleButtons({
  onApply,
}: {
  onApply: (role: StaffRole, isScheduled: boolean) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onApply('technician', true)}
        className={`${sectionLabel} h-8 border border-emerald-300 bg-emerald-50 px-3 text-emerald-700`}
      >
        All Tech Mon-Fri On
      </button>
      <button
        type="button"
        onClick={() => onApply('technician', false)}
        className={`${sectionLabel} h-8 border border-gray-300 bg-white px-3 text-gray-700`}
      >
        All Tech Mon-Fri Off
      </button>
      <button
        type="button"
        onClick={() => onApply('packer', true)}
        className={`${sectionLabel} h-8 border border-emerald-300 bg-emerald-50 px-3 text-emerald-700`}
      >
        All Packer Mon-Fri On
      </button>
      <button
        type="button"
        onClick={() => onApply('packer', false)}
        className={`${sectionLabel} h-8 border border-gray-300 bg-white px-3 text-gray-700`}
      >
        All Packer Mon-Fri Off
      </button>
    </div>
  );
}
