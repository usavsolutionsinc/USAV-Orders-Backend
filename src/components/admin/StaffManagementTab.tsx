'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import type { Staff } from './types';
import { sectionLabel, tableHeader, dataValue } from '@/design-system/tokens/typography/presets';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';
import {
  STAFF_SCHEDULE_TIMEZONE,
  STAFF_WEEKDAY_LABELS,
  type StaffDayOfWeek,
  getCurrentStaffDayOfWeek,
  getStaffWeekdayLabel,
} from '@/lib/staff-schedule';

type StaffRole = 'technician' | 'packer';

interface StaffScheduleRow {
  staff_id: number;
  day_of_week: number;
  is_scheduled: boolean;
}

interface StaffScheduleResponse {
  timezone: string;
  today_day_of_week: number;
  schedules: StaffScheduleRow[];
}

interface StaffScheduleUpdatePayload {
  staffId: number;
  dayOfWeek: number;
  isScheduled: boolean;
}

type ScheduleMap = Record<number, Record<number, boolean>>;

const WEEKDAY_COLUMNS: Array<{ value: StaffDayOfWeek; label: string }> = STAFF_WEEKDAY_LABELS.map((label, index) => ({
  value: index as StaffDayOfWeek,
  label,
}));

export function StaffManagementTab() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<StaffRole>('technician');
  const [newStaffEmployeeId, setNewStaffEmployeeId] = useState('');
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<StaffRole>('technician');
  const [editEmployeeId, setEditEmployeeId] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [savingScheduleKey, setSavingScheduleKey] = useState<string | null>(null);

  const { data: staff = [] } = useQuery<Staff[]>({
    queryKey: ['staff'],
    queryFn: async () => {
      const res = await fetch('/api/staff?active=false');
      if (!res.ok) throw new Error('Failed to fetch staff');
      return res.json();
    },
  });

  const { data: scheduleResponse } = useQuery<StaffScheduleResponse>({
    queryKey: ['staff-schedule'],
    queryFn: async () => {
      const res = await fetch('/api/staff/schedule?includeInactive=true');
      if (!res.ok) throw new Error('Failed to fetch staff schedule');
      return res.json();
    },
  });

  const createStaffMutation = useMutation({
    mutationFn: async (data: { name: string; role: StaffRole; employee_id: string; active: boolean }) => {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create staff');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      queryClient.invalidateQueries({ queryKey: ['staff-schedule'] });
      setIsAddingStaff(false);
      setNewStaffName('');
      setNewStaffEmployeeId('');
      setNewStaffRole('technician');
    },
  });

  const updateStaffMutation = useMutation({
    mutationFn: async (data: {
      id: number;
      name?: string;
      role?: StaffRole;
      employee_id?: string;
      active?: boolean;
    }) => {
      const res = await fetch('/api/staff', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update staff');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      queryClient.invalidateQueries({ queryKey: ['staff-schedule'] });
      setEditingStaffId(null);
    },
  });

  const deleteStaffMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/staff?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete staff');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      queryClient.invalidateQueries({ queryKey: ['staff-schedule'] });
      setEditingStaffId(null);
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: async (data: StaffScheduleUpdatePayload) => {
      const res = await fetch('/api/staff/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update schedule');
      return res.json();
    },
    onMutate: (variables) => {
      setSavingScheduleKey(`${variables.staffId}:${variables.dayOfWeek}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
    onSettled: () => {
      setSavingScheduleKey(null);
    },
  });

  const startEditStaff = (member: Staff) => {
    setEditingStaffId(member.id);
    setEditName(member.name || '');
    setEditRole((member.role as StaffRole) || 'technician');
    setEditEmployeeId(member.employee_id || '');
    setEditActive(Boolean(member.active));
  };

  useEffect(() => {
    const handleOpenAdd = () => setIsAddingStaff(true);
    window.addEventListener('admin-staff-open-add', handleOpenAdd as EventListener);
    return () => window.removeEventListener('admin-staff-open-add', handleOpenAdd as EventListener);
  }, []);

  const searchTerm = (searchParams.get('search') || '').trim().toLowerCase();
  const staffView = searchParams.get('staffView') || 'all';

  const filteredStaff = useMemo(() => {
    return staff.filter((member) => {
      const matchesSearch =
        !searchTerm ||
        member.name.toLowerCase().includes(searchTerm) ||
        (member.employee_id || '').toLowerCase().includes(searchTerm);

      const matchesView =
        staffView === 'active'
          ? Boolean(member.active)
          : staffView === 'inactive'
            ? !member.active
            : staffView === 'technician'
              ? member.role === 'technician'
              : staffView === 'packer'
                ? member.role === 'packer'
                : true;

      return matchesSearch && matchesView;
    });
  }, [searchTerm, staff, staffView]);

  const scheduleMap = useMemo<ScheduleMap>(() => {
    const map: ScheduleMap = {};

    for (const member of staff) {
      map[member.id] = {};
      for (const day of WEEKDAY_COLUMNS) {
        map[member.id][day.value] = true;
      }
    }

    for (const row of scheduleResponse?.schedules || []) {
      if (!map[row.staff_id]) map[row.staff_id] = {};
      map[row.staff_id][row.day_of_week] = Boolean(row.is_scheduled);
    }

    return map;
  }, [scheduleResponse?.schedules, staff]);

  const todayDay = Number.isFinite(Number(scheduleResponse?.today_day_of_week))
    ? Number(scheduleResponse?.today_day_of_week)
    : getCurrentStaffDayOfWeek();
  const todayLabel = getStaffWeekdayLabel(todayDay);
  const timezoneLabel = scheduleResponse?.timezone || STAFF_SCHEDULE_TIMEZONE;

  const getIsScheduled = (staffId: number, dayOfWeek: number) => {
    return scheduleMap[staffId]?.[dayOfWeek] ?? true;
  };

  const summary = useMemo(() => {
    return filteredStaff.reduce(
      (acc, member) => {
        acc.total += 1;
        if (member.active) acc.active += 1;
        else acc.inactive += 1;
        if (member.role === 'technician') acc.technicians += 1;
        if (member.role === 'packer') acc.packers += 1;
        const isScheduledToday = getIsScheduled(member.id, todayDay);
        if (member.active && isScheduledToday) acc.presentToday += 1;
        else if (member.active) acc.offToday += 1;
        return acc;
      },
      { total: 0, active: 0, inactive: 0, technicians: 0, packers: 0, presentToday: 0, offToday: 0 }
    );
  }, [filteredStaff, todayDay, scheduleMap]);

  const toggleSchedule = (staffId: number, dayOfWeek: StaffDayOfWeek, isActive: boolean) => {
    if (!isActive) return;
    const current = getIsScheduled(staffId, dayOfWeek);
    updateScheduleMutation.mutate({
      staffId,
      dayOfWeek,
      isScheduled: !current,
    });
  };

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)]">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} px-6`}>
          <p className={`${sectionLabel} truncate text-gray-900`}>
            Staff Directory
          </p>
          <div className={`${sectionLabel} hidden items-center gap-3 sm:flex`}>
            <span>Shown {summary.total}</span>
            <span className="text-gray-500">/</span>
            <span>Scheduled Today {summary.presentToday}</span>
            <span className="text-gray-500">/</span>
            <span>{todayLabel}</span>
          </div>
        </div>
      </div>

      {isAddingStaff && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-6 mt-5 border border-gray-200 bg-white"
        >
          <div className="grid gap-4 border-b border-gray-200 px-4 py-4 md:grid-cols-3">
            <label className="space-y-1">
              <span className={`block ${sectionLabel}`}>Full Name</span>
              <input
                type="text"
                value={newStaffName}
                onChange={(e) => setNewStaffName(e.target.value)}
                className="h-9 w-full border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none transition-colors focus:border-gray-400"
                placeholder="Enter full name"
              />
            </label>

            <label className="space-y-1">
              <span className={`block ${sectionLabel}`}>Employee ID</span>
              <input
                type="text"
                value={newStaffEmployeeId}
                onChange={(e) => setNewStaffEmployeeId(e.target.value)}
                className="h-9 w-full border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none transition-colors focus:border-gray-400"
                placeholder="Enter employee ID"
              />
            </label>

            <label className="space-y-1">
              <span className={`block ${sectionLabel}`}>Role</span>
              <select
                value={newStaffRole}
                onChange={(e) => setNewStaffRole(e.target.value as StaffRole)}
                className="h-9 w-full border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none transition-colors focus:border-gray-400"
              >
                <option value="technician">Technician</option>
                <option value="packer">Packer</option>
              </select>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 px-4 py-3">
            <button
              type="button"
              onClick={() => setIsAddingStaff(false)}
              className={`${sectionLabel} h-9 border border-gray-300 px-4 text-gray-600 transition-colors hover:bg-gray-50`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() =>
                newStaffName.trim() &&
                createStaffMutation.mutate({
                  name: newStaffName.trim(),
                  role: newStaffRole,
                  employee_id: newStaffEmployeeId.trim(),
                  active: true,
                })
              }
              className={`${sectionLabel} h-9 border border-emerald-700 bg-emerald-700 px-4 text-white transition-colors hover:bg-emerald-800`}
            >
              Add Staff Member
            </button>
          </div>
        </motion.div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 grid gap-2 sm:grid-cols-5">
          <SummaryCell label="Shown" value={summary.total} />
          <SummaryCell label="Active" value={summary.active} />
          <SummaryCell label="Technicians" value={summary.technicians} />
          <SummaryCell label="Packers" value={summary.packers} />
          <SummaryCell label="Scheduled Today" value={summary.presentToday} tone="emerald" />
        </div>

        <div className={`${sectionLabel} mb-2 flex items-center justify-between`}>
          <span>Weekly Schedule</span>
          <span>{todayLabel} • {timezoneLabel}</span>
        </div>

        <div className="overflow-x-auto border border-gray-200 bg-white">
          <div className="min-w-[980px]">
            <div className="grid grid-cols-[minmax(320px,1fr)_repeat(7,minmax(54px,1fr))_120px] items-center border-b border-gray-200 bg-gray-50 px-4 py-2.5">
              <span className={tableHeader}>Staff</span>
              {WEEKDAY_COLUMNS.map((day) => (
                <span
                  key={`header-${day.value}`}
                  className={`${tableHeader} text-center ${
                    day.value === todayDay ? 'text-gray-900' : ''
                  }`}
                >
                  {day.label}
                </span>
              ))}
              <span className={`${tableHeader} text-right`}>Actions</span>
            </div>

            {filteredStaff.map((member) => {
              if (editingStaffId === member.id) {
                return (
                  <div key={member.id} className="border-b border-gray-100 px-4 py-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-9 border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-gray-400"
                        placeholder="Full Name"
                      />
                      <input
                        type="text"
                        value={editEmployeeId}
                        onChange={(e) => setEditEmployeeId(e.target.value)}
                        className="h-9 border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-gray-400"
                        placeholder="Enter employee ID"
                      />
                      <select
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value as StaffRole)}
                        className="h-9 border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-gray-400"
                      >
                        <option value="technician">Technician</option>
                        <option value="packer">Packer</option>
                      </select>
                    </div>

                    <label className={`${sectionLabel} mt-3 inline-flex items-center gap-2 text-gray-600`}>
                      <input
                        type="checkbox"
                        checked={editActive}
                        onChange={(e) => setEditActive(e.target.checked)}
                        className="h-4 w-4 border-gray-300 text-gray-900"
                      />
                      Active Staff Record
                    </label>

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateStaffMutation.mutate({
                            id: member.id,
                            name: editName.trim(),
                            role: editRole,
                            employee_id: editEmployeeId.trim(),
                            active: editActive,
                          })
                        }
                        className={`${sectionLabel} h-9 border border-gray-900 bg-gray-900 px-4 text-white`}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingStaffId(null)}
                        className={`${sectionLabel} h-9 border border-gray-300 px-4 text-gray-700 hover:bg-gray-50`}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteStaffMutation.mutate(member.id)}
                      className={`${sectionLabel} h-9 border border-red-300 px-4 text-red-700 hover:bg-red-50`}
                    >
                        Deactivate Staff
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={member.id}
                  className={`grid grid-cols-[minmax(320px,1fr)_repeat(7,minmax(54px,1fr))_120px] items-center border-b border-gray-100 px-4 py-2.5 ${
                    !member.active ? 'bg-gray-50 text-gray-500' : 'bg-white'
                  }`}
                >
                  <div className="min-w-0 pr-3">
                    <p className={`${dataValue} truncate uppercase tracking-[0.02em]`}>
                      {member.name}
                    </p>
                    <div className={`${tableHeader} mt-0.5 flex items-center gap-2`}>
                      <span>{member.role}</span>
                      {member.employee_id ? <span>ID {member.employee_id}</span> : null}
                      <span>{member.active ? 'Active' : 'Inactive'}</span>
                    </div>
                  </div>

                  {WEEKDAY_COLUMNS.map((day) => {
                    const isScheduled = getIsScheduled(member.id, day.value);
                    const isToday = day.value === todayDay;
                    const buttonKey = `${member.id}:${day.value}`;
                    const isDisabled = !member.active || savingScheduleKey === buttonKey;

                    return (
                      <button
                        key={`${member.id}-${day.value}`}
                        type="button"
                        onClick={() => toggleSchedule(member.id, day.value, Boolean(member.active))}
                        disabled={isDisabled}
                        className={[
                          `mx-1 h-8 border ${tableHeader} transition-colors`,
                          isScheduled
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 bg-gray-50 text-gray-500',
                          isToday ? 'outline outline-1 outline-gray-900/30' : '',
                          isDisabled ? 'cursor-not-allowed opacity-50' : 'hover:border-gray-400',
                        ].join(' ')}
                        aria-pressed={isScheduled}
                        aria-label={`${member.name} ${day.label} ${member.active ? (isScheduled ? 'scheduled' : 'off') : 'inactive'}`}
                        title={`${member.name} • ${day.label}`}
                      >
                        {isScheduled ? 'On' : 'Off'}
                      </button>
                    );
                  })}

                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => startEditStaff(member)}
                      className={`${tableHeader} h-8 border border-gray-300 px-3 text-gray-700 transition-colors hover:bg-gray-50`}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {filteredStaff.length === 0 && (
          <div className="border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
            <p className={sectionLabel}>No Staff Match</p>
            <p className="mt-2 text-[12px] font-bold text-gray-500">
              Change the sidebar filters or add a team member.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function SummaryCell({ label, value, tone = 'gray' }: { label: string; value: number; tone?: 'gray' | 'emerald' }) {
  const valueClass = tone === 'emerald' ? 'text-emerald-700' : 'text-gray-900';
  return (
    <div className="border border-gray-200 bg-white px-3 py-2.5">
      <p className={sectionLabel}>{label}</p>
      <p className={`mt-1 text-xl font-black tracking-tight ${valueClass}`}>{value}</p>
    </div>
  );
}
