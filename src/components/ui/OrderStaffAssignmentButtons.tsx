'use client';

import { getStaffThemeById, stationThemeClasses } from '@/utils/staff-colors';

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

function resolveTechTheme(staffId: number) {
  if (staffId === 1) return 'green';
  if (staffId === 2) return 'blue';
  if (staffId === 3) return 'purple';
  if (staffId === 4 || staffId === 6) return 'yellow';
  return getStaffThemeById(staffId, 'technician');
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
    <div className="flex items-start gap-2 min-w-0">
      <span className="shrink-0 pt-2 text-[9px] font-black uppercase tracking-widest text-slate-400 w-9">Tech</span>
      <div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {testerOptions.map((member) => {
          const isActive = testerId === member.id;
          const theme = resolveTechTheme(member.id);
          const themeClass = stationThemeClasses[theme];
          const isPurple3Fallback = member.id === 3 && !isActive;
          return (
            <button
              key={member.id}
              type="button"
              aria-pressed={isActive}
              disabled={disabled || testerDisabled}
              onClick={(e) => {
                e.stopPropagation();
                if (!disabled && !testerDisabled && !isActive) void onAssignTester(member.id);
              }}
              className={[
                'touch-manipulation h-14 min-w-[112px] px-3.5 rounded-xl text-[11px] font-black uppercase tracking-[0.08em] border transition-all disabled:opacity-50',
                isActive ? themeClass.active : themeClass.inactive,
                isPurple3Fallback
                  ? '!text-purple-700 !border-purple-200 !bg-white hover:!bg-purple-50'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {member.name}
            </button>
          );
        })}
      </div>
    </div>
  );

  const packRow = (
    <div className="flex items-start gap-2 min-w-0">
      <span className="shrink-0 pt-2 text-[9px] font-black uppercase tracking-widest text-slate-400 w-9">Pack</span>
      <div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {packerOptions.map((member) => {
          const isActive = packerId === member.id;
          const theme = getStaffThemeById(member.id, 'packer');
          const themeClass = stationThemeClasses[theme];
          const isSlate4 = member.id === 4;
          const packerClass = isSlate4
            ? isActive
              ? 'bg-slate-800 text-white border-slate-800'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            : isActive
              ? themeClass.active
              : themeClass.inactive;
          return (
            <button
              key={member.id}
              type="button"
              aria-pressed={isActive}
              disabled={disabled || packerDisabled}
              onClick={(e) => {
                e.stopPropagation();
                if (!disabled && !packerDisabled && !isActive) void onAssignPacker(member.id);
              }}
              className={`touch-manipulation h-14 min-w-[112px] px-3.5 rounded-xl text-[11px] font-black uppercase tracking-[0.08em] border transition-all disabled:opacity-50 ${packerClass}`}
            >
              {member.name}
            </button>
          );
        })}
      </div>
    </div>
  );

  const showPackRow = packerOptions.length > 0;

  if (layout === 'rows') {
    return (
      <div className="flex flex-col gap-1.5" onClick={onContainerClick}>
        {techRow}
        {showPackRow && packRow}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5" onClick={onContainerClick}>
      {techRow}
      {showPackRow && packRow}
    </div>
  );
}
