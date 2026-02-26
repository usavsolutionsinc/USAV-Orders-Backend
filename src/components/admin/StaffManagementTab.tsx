'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus } from '@/components/Icons';
import type { Staff } from './types';

export function StaffManagementTab() {
  const queryClient = useQueryClient();
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<'technician' | 'packer'>('technician');
  const [newStaffEmployeeId, setNewStaffEmployeeId] = useState('');
  const [newStaffSourceTable, setNewStaffSourceTable] = useState('');
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<'technician' | 'packer'>('technician');
  const [editEmployeeId, setEditEmployeeId] = useState('');
  const [editSourceTable, setEditSourceTable] = useState('');
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
    mutationFn: async (data: { name: string; role: string; employee_id: string; source_table: string; active: boolean }) => {
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
      setNewStaffSourceTable('');
      setNewStaffRole('technician');
    },
  });

  const updateStaffMutation = useMutation({
    mutationFn: async (data: {
      id: number;
      name?: string;
      role?: string;
      employee_id?: string;
      source_table?: string;
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
    setEditSourceTable(member.source_table || '');
    setEditActive(Boolean(member.active));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Active Personnel</h2>
        <button
          onClick={() => setIsAddingStaff(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" /> New Staff
        </button>
      </div>

      {isAddingStaff && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-white rounded-3xl border border-gray-200 shadow-sm space-y-4"
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
            <label className="text-[9px] font-black text-gray-600 uppercase px-2 tracking-widest">Source Table</label>
            <input
              type="text"
              value={newStaffSourceTable}
              onChange={(e) => setNewStaffSourceTable(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-gray-900 font-bold text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
              placeholder="tech_1, tech_2, packer_1..."
            />
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
                  source_table: newStaffSourceTable,
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

      <div className="grid gap-3">
        {staff.map((member) => (
          <div
            key={member.id}
            className={`p-5 rounded-3xl bg-white border border-gray-200 transition-all group hover:shadow-sm ${!member.active && 'opacity-40 grayscale'}`}
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
                  <input
                    type="text"
                    value={editSourceTable}
                    onChange={(e) => setEditSourceTable(e.target.value)}
                    className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                    placeholder="source_table"
                  />
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
                        source_table: editSourceTable,
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
                      {member.source_table && (
                        <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">• SRC: {member.source_table}</span>
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
      </div>
    </div>
  );
}
