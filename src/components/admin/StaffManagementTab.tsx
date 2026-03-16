'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import type { Staff } from './types';

export function StaffManagementTab() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<'technician' | 'packer'>('technician');
  const [newStaffEmployeeId, setNewStaffEmployeeId] = useState('');
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<'technician' | 'packer'>('technician');
  const [editEmployeeId, setEditEmployeeId] = useState('');
  const [editActive, setEditActive] = useState(true);

  const { data: staff = [] } = useQuery<Staff[]>({
    queryKey: ['staff'],
    queryFn: async () => {
      const res = await fetch('/api/staff?active=false');
      if (!res.ok) throw new Error('Failed to fetch staff');
      return res.json();
    },
  });

  const createStaffMutation = useMutation({
    mutationFn: async (data: { name: string; role: string; employee_id: string; active: boolean }) => {
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
      role?: string;
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
      setEditingStaffId(null);
    },
  });

  const startEditStaff = (member: Staff) => {
    setEditingStaffId(member.id);
    setEditName(member.name || '');
    setEditRole((member.role as 'technician' | 'packer') || 'technician');
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

  const summary = useMemo(() => {
    return filteredStaff.reduce(
      (acc, member) => {
        acc.total += 1;
        if (member.active) acc.active += 1;
        else acc.inactive += 1;
        if (member.role === 'technician') acc.technicians += 1;
        if (member.role === 'packer') acc.packers += 1;
        return acc;
      },
      { total: 0, active: 0, inactive: 0, technicians: 0, packers: 0 }
    );
  }, [filteredStaff]);

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)]">
      <div className="border-b border-gray-200 bg-white/90 px-6 py-5 backdrop-blur">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Personnel Control Room</p>
            <h2 className="mt-2 text-lg font-black uppercase tracking-[0.18em] text-slate-900">Staff Directory</h2>
            <p className="mt-2 text-[12px] font-bold leading-relaxed text-slate-500">
              Use the sidebar to search, segment, and add team members. This board stays focused on personnel records and editing.
            </p>
          </div>

          <div className="grid min-w-[280px] flex-1 gap-3 sm:grid-cols-4">
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Visible Staff</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{summary.total}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Active</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{summary.active}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Technicians</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{summary.technicians}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Packers</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{summary.packers}</p>
            </div>
          </div>
        </div>
      </div>

      {isAddingStaff && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-6 mt-6 border border-gray-200 bg-white p-6 shadow-sm space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[9px] font-black text-gray-600 uppercase px-2 tracking-widest">Full Name</label>
              <input
                type="text"
                value={newStaffName}
                onChange={(e) => setNewStaffName(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-gray-900 font-bold text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                placeholder="Enter name..."
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] font-black text-gray-600 uppercase px-2 tracking-widest">Employee ID</label>
              <input
                type="text"
                value={newStaffEmployeeId}
                onChange={(e) => setNewStaffEmployeeId(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-gray-900 font-bold text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                placeholder="Enter ID..."
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[9px] font-black text-gray-600 uppercase px-2 tracking-widest">Assign Role</label>
            <div className="flex gap-2">
              {['technician', 'packer'].map((r) => (
                <button
                  key={r}
                  onClick={() => setNewStaffRole(r as any)}
                  className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border ${
                    newStaffRole === r
                      ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={() =>
                newStaffName.trim() &&
                createStaffMutation.mutate({
                  name: newStaffName,
                  role: newStaffRole,
                  employee_id: newStaffEmployeeId,
                  active: true,
                })
              }
              className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-sm transition-all"
            >
              Add Personnel
            </button>
            <button
              onClick={() => setIsAddingStaff(false)}
              className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all"
            >
              Cancel
            </button>
          </div>
        </motion.div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="grid gap-3">
        {filteredStaff.map((member) => (
          <div
            key={member.id}
            className={`p-5 bg-white border border-gray-200 transition-all group hover:shadow-sm ${!member.active && 'opacity-50 grayscale-[0.15]'}`}
          >
            {editingStaffId === member.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                    placeholder="Full Name"
                  />
                  <input
                    type="text"
                    value={editEmployeeId}
                    onChange={(e) => setEditEmployeeId(e.target.value)}
                    className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                    placeholder="Employee ID"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as 'technician' | 'packer')}
                    className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                  >
                    <option value="technician">technician</option>
                    <option value="packer">packer</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-600">
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(e) => setEditActive(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  Active
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      updateStaffMutation.mutate({
                        id: member.id,
                        name: editName.trim(),
                        role: editRole,
                        employee_id: editEmployeeId,
                        active: editActive,
                      })
                    }
                    className="flex-1 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-widest"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingStaffId(null)}
                    className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-[10px] font-black uppercase tracking-widest"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteStaffMutation.mutate(member.id)}
                    className="px-4 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-black uppercase tracking-widest border border-red-200"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-5">
                  <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-sm font-black shadow-sm text-blue-600 border border-blue-100">
                    {member.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-base font-black text-gray-900">{member.name}</div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">{member.role}</span>
                      {member.employee_id && (
                        <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">• ID: {member.employee_id}</span>
                      )}
                      <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">• {member.active ? 'Active' : 'Inactive'}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEditStaff(member)}
                    className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-blue-200 text-blue-600 hover:bg-blue-50 transition-all"
                  >
                    Edit
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {filteredStaff.length === 0 && (
          <div className="border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">No Staff Matched</p>
            <p className="mt-2 text-[12px] font-bold text-slate-500">
              Adjust the staff sidebar filters or add a new team member.
            </p>
          </div>
        )}
        </div>
      </div>
    </section>
  );
}
