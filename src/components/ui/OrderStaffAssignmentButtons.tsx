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
  onAssignTester: (staffId: number) => void;
  onAssignPacker: (staffId: number) => void;
  onContainerClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  disabled?: boolean;
  layout?: 'columns' | 'rows';
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
  layout = 'columns',
}: OrderStaffAssignmentButtonsProps) {
  const resolveTechnicianTheme = (staffId: number) => {
    if (staffId === 1) return 'green';
    if (staffId === 2) return 'blue';
    if (staffId === 3) return 'purple';
    if (staffId === 4 || staffId === 6) return 'yellow';
    return getStaffThemeById(staffId, 'technician');
  };

  const testerRow = (
    <div className="bg-gray-50 rounded-xl border border-gray-100 flex items-center gap-2">
      <div className="flex-1 flex flex-wrap gap-1.5">
        {testerOptions.map((member) => {
          const isActiveTester = testerId === member.id;
          const testerTheme = resolveTechnicianTheme(member.id);
          const testerThemeClasses = stationThemeClasses[testerTheme];
          const isTech3PurpleFallback = member.id === 3 && !isActiveTester;
          return (
            <button
              key={member.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!disabled) onAssignTester(member.id);
              }}
              disabled={disabled}
              className={`px-2.5 h-8 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-colors disabled:opacity-50 ${
                isActiveTester ? testerThemeClasses.active : testerThemeClasses.inactive
              } ${isTech3PurpleFallback ? '!text-purple-700 !border-purple-300 !bg-white hover:!bg-purple-50' : ''}`}
            >
              {member.name}
            </button>
          );
        })}
      </div>
    </div>
  );

  const packerRow = (
    <div className="bg-gray-50 rounded-xl border border-gray-100 flex items-center gap-2">
      <div className="flex-1 flex flex-wrap gap-1.5">
        {packerOptions.map((member) => {
          const isActivePacker = packerId === member.id;
          const packerTheme = getStaffThemeById(member.id, 'packer');
          const packerThemeClasses = stationThemeClasses[packerTheme];
          const packerClasses =
            member.id === 4
              ? (
                isActivePacker
                  ? 'bg-slate-300 text-slate-900 border-slate-500 shadow-sm'
                  : 'bg-slate-100 text-slate-900 border-slate-300 hover:bg-slate-200'
              )
              : (isActivePacker ? packerThemeClasses.active : packerThemeClasses.inactive);
          return (
            <button
              key={member.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!disabled) onAssignPacker(member.id);
              }}
              disabled={disabled}
              className={`px-2.5 h-8 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-colors disabled:opacity-50 ${packerClasses}`}
            >
              {member.name}
            </button>
          );
        })}
      </div>
    </div>
  );

  if (layout === 'rows') {
    return (
      <div className="grid grid-rows-2 gap-2" onClick={onContainerClick}>
        {testerRow}
        {packerRow}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3" onClick={onContainerClick}>
      {testerRow}
      {packerRow}
    </div>
  );
}
