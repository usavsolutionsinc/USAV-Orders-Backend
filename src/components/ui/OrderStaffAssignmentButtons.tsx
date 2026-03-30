'use client';

import { getStaffThemeById, stationThemeClasses } from '@/utils/staff-colors';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

export interface AssignmentStaffOption {
  id: number;
  name: string;
}

interface OrderStaffAssignmentButtonsProps {
  testerOptions: AssignmentStaffOption[];
  packerOptions: AssignmentStaffOption[];
  testerId: number | null;
  packerId: number | null;
  onAssignTester: (staffId: number) => void | Promise<void>;
  onAssignPacker: (staffId: number) => void | Promise<void>;
  onContainerClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  disabled?: boolean;
  testerDisabled?: boolean;
  packerDisabled?: boolean;
  layout?: 'columns' | 'rows';
}

function StaffButtonRow({
  label,
  options,
  activeId,
  disabled,
  onAssign,
}: {
  label: string;
  options: AssignmentStaffOption[];
  activeId: number | null;
  disabled: boolean;
  onAssign: (staffId: number) => void | Promise<void>;
}) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className={`shrink-0 pt-2 ${sectionLabel} w-9`}>{label}</span>
      <div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {options.map((member) => {
          const isActive = activeId === member.id;
          const theme = getStaffThemeById(member.id);
          const themeClass = stationThemeClasses[theme];
          return (
            <button
              key={member.id}
              type="button"
              aria-pressed={isActive}
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                if (!disabled && !isActive) void onAssign(member.id);
              }}
              className={`touch-manipulation h-14 min-w-[112px] px-3.5 rounded-xl text-[11px] font-black uppercase tracking-[0.08em] border transition-all disabled:opacity-50 ${isActive ? themeClass.active : themeClass.inactive}`}
            >
              {member.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function OrderStaffAssignmentButtons({
  testerOptions,
  packerOptions,
  testerId,
  packerId,
  onAssignTester,
  onAssignPacker,
  onContainerClick,
  disabled = false,
  testerDisabled = false,
  packerDisabled = false,
  layout = 'columns',
}: OrderStaffAssignmentButtonsProps) {
  const techRow = (
    <StaffButtonRow
      label="Tech"
      options={testerOptions}
      activeId={testerId}
      disabled={disabled || testerDisabled}
      onAssign={onAssignTester}
    />
  );

  const showPackRow = packerOptions.length > 0;
  const packRow = showPackRow ? (
    <StaffButtonRow
      label="Pack"
      options={packerOptions}
      activeId={packerId}
      disabled={disabled || packerDisabled}
      onAssign={onAssignPacker}
    />
  ) : null;

  if (layout === 'rows') {
    return (
      <div className="flex flex-col gap-1.5" onClick={onContainerClick}>
        {techRow}
        {packRow}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5" onClick={onContainerClick}>
      {techRow}
      {packRow}
    </div>
  );
}
