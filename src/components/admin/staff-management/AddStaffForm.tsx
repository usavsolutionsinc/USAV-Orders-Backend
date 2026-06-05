import { useState } from 'react';
import { motion } from 'framer-motion';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import type { StaffRole } from './constants';

export interface NewStaffPayload {
  name: string;
  role: StaffRole;
  employee_id: string;
  active: boolean;
}

export function AddStaffForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (payload: NewStaffPayload) => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('technician');
  const [employeeId, setEmployeeId] = useState('');

  return (
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
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-full border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none transition-colors focus:border-gray-400"
            placeholder="Enter full name"
          />
        </label>

        <label className="space-y-1">
          <span className={`block ${sectionLabel}`}>Employee ID</span>
          <input
            type="text"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="h-9 w-full border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none transition-colors focus:border-gray-400"
            placeholder="Enter employee ID"
          />
        </label>

        <label className="space-y-1">
          <span className={`block ${sectionLabel}`}>Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
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
          onClick={onCancel}
          className={`${sectionLabel} h-9 border border-gray-300 px-4 text-gray-600 transition-colors hover:bg-gray-50`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() =>
            name.trim() &&
            onCreate({
              name: name.trim(),
              role,
              employee_id: employeeId.trim(),
              active: true,
            })
          }
          className={`${sectionLabel} h-9 border border-emerald-700 bg-emerald-700 px-4 text-white transition-colors hover:bg-emerald-800`}
        >
          Add Staff Member
        </button>
      </div>
    </motion.div>
  );
}
