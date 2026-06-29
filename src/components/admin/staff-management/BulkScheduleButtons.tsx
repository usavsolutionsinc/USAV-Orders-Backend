import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { Button } from '@/design-system/primitives';
import type { StaffRole } from './constants';

export function BulkScheduleButtons({
  onApply,
}: {
  onApply: (role: StaffRole, isScheduled: boolean) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onApply('technician', true)}
        className={`${sectionLabel} border border-emerald-300 bg-emerald-50 text-emerald-700`}
      >
        All Tech Mon-Fri On
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onApply('technician', false)}
        className={sectionLabel}
      >
        All Tech Mon-Fri Off
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onApply('packer', true)}
        className={`${sectionLabel} border border-emerald-300 bg-emerald-50 text-emerald-700`}
      >
        All Packer Mon-Fri On
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onApply('packer', false)}
        className={sectionLabel}
      >
        All Packer Mon-Fri Off
      </Button>
    </div>
  );
}
