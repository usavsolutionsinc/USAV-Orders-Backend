import { useState } from 'react';
import type { ReactNode } from 'react';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import { StaffColorWheel } from '../StaffColorWheel';
import { getStaffColorHex } from '@/utils/staff-colors';
import type { Staff } from '../types';
import { STAFF_HOME_OPTIONS, type StaffRole, type StaffUpdatePayload } from './constants';

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gray-500">{label}</span>
      {children}
    </label>
  );
}

/**
 * The inline "edit staff" card rendered in place of a directory row. Owns its
 * own draft fields seeded from `member`; on save it diffs against `member` and
 * emits only the changed keys, matching the API's partial-update contract.
 */
export function StaffEditCard({
  member,
  onSave,
  onCancel,
  onDelete,
}: {
  member: Staff;
  onSave: (payload: StaffUpdatePayload) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const memberColor = getStaffColorHex(member);
  const [editName, setEditName] = useState(member.name || '');
  const [editRole, setEditRole] = useState<StaffRole>((member.role as StaffRole) || 'technician');
  const [editEmployeeId, setEditEmployeeId] = useState(member.employee_id || '');
  const [editActive, setEditActive] = useState(Boolean(member.active));
  const [editColorHex, setEditColorHex] = useState(memberColor);
  const [editDefaultHomePath, setEditDefaultHomePath] = useState<string>(member.default_home_path || '');

  const handleSave = () => {
    const payload: StaffUpdatePayload = { id: member.id };
    if (editName.trim() !== member.name) payload.name = editName.trim();
    if (editEmployeeId.trim() !== (member.employee_id || '')) payload.employee_id = editEmployeeId.trim();
    if (editActive !== member.active) payload.active = editActive;
    if (editColorHex.toLowerCase() !== memberColor.toLowerCase()) {
      payload.color_hex = editColorHex;
    }
    // Empty string in the form = "use role default" = NULL in DB.
    const nextHome = editDefaultHomePath || null;
    if (nextHome !== (member.default_home_path || null)) {
      payload.default_home_path = nextHome;
    }
    // Role select only supports technician/packer — only send it if the staff
    // is currently one of those AND the value changed. Sending role='admin'
    // (etc.) trips the API's tech/packer-only check.
    if (
      editRole !== member.role &&
      (member.role === 'technician' || member.role === 'packer')
    ) {
      payload.role = editRole;
    }
    onSave(payload);
  };

  return (
    <div key={member.id} className="border-b border-gray-100 px-3 py-4">
      {/* Card shell: rounded, soft shadow, left accent border in the live
          editing color. Every interior radius is fully rounded — no square
          corners. */}
      <div
        className="rounded-3xl bg-gradient-to-br from-white via-white to-gray-50 px-6 py-5 shadow-md shadow-gray-200/40 ring-1 ring-gray-200"
        style={{ boxShadow: `inset 4px 0 0 0 ${editColorHex}, 0 4px 12px -4px rgb(0 0 0 / 0.08)` }}
      >
        {/* Identity header: large initials chip in the live edit color next to
            the name/role badge. */}
        <div className="mb-6 flex items-center gap-4">
          <div
            className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full text-xl font-bold text-white shadow-lg shadow-gray-900/15 ring-4 ring-white transition-colors"
            style={{ backgroundColor: editColorHex }}
          >
            {member.name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-xl font-bold tracking-tight text-gray-900">{member.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-micro font-semibold uppercase tracking-[0.14em] text-gray-700">{member.role}</span>
              {member.employee_id ? (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-micro font-semibold uppercase tracking-[0.14em] text-gray-700">ID {member.employee_id}</span>
              ) : null}
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-micro font-semibold uppercase tracking-[0.14em] ${member.active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'}`}>
                {member.active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>

        {/* Form grid — fully rounded pill inputs. */}
        <div className="grid gap-4 md:grid-cols-3">
          <FieldGroup label="Full Name">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-11 w-full rounded-full border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
              placeholder="Full name"
            />
          </FieldGroup>
          <FieldGroup label="Employee ID">
            <input
              type="text"
              value={editEmployeeId}
              onChange={(e) => setEditEmployeeId(e.target.value)}
              className="h-11 w-full rounded-full border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
              placeholder="Employee ID"
            />
          </FieldGroup>
          <FieldGroup label="Role">
            <HoverTooltip
              label={member.role !== 'technician' && member.role !== 'packer' ? `Role "${member.role}" is managed in the Roles tab` : ''}
              asChild
            >
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value as StaffRole)}
                disabled={member.role !== 'technician' && member.role !== 'packer'}
                className="h-11 w-full rounded-full border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="technician">Technician</option>
                <option value="packer">Packer</option>
              </select>
            </HoverTooltip>
          </FieldGroup>
        </div>

        {/* Identity color card — fully rounded, wheel anchored right so the eye
            lands on it immediately. */}
        <div className="mt-5 flex items-center gap-4 rounded-3xl border border-gray-200 bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gray-500">Identity color</p>
            <p className="mt-1 text-label text-gray-500">Tap the wheel — picks up on the sidebar, sign-in picker, and FAB.</p>
          </div>
          <StaffColorWheel value={editColorHex} onChange={setEditColorHex} />
        </div>

        {/* Default home page — per-staff override of ROLE_HOME. Empty value =
            fall back to role default. The select is sourced from
            STAFF_HOME_OPTIONS so admins can't typo a 404 path. */}
        <div className="mt-4 flex items-center gap-4 rounded-3xl border border-gray-200 bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gray-500">Default home page</p>
            <p className="mt-1 text-label text-gray-500">
              Where this staffer lands after sign-in. Use role default keeps the current behavior.
            </p>
          </div>
          <select
            value={editDefaultHomePath}
            onChange={(e) => setEditDefaultHomePath(e.target.value)}
            className="h-11 min-w-[14rem] rounded-full border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
          >
            <option value="">Use role default</option>
            {STAFF_HOME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <label className="mt-5 inline-flex cursor-pointer items-center gap-2.5 rounded-full bg-white px-3.5 py-2 text-caption font-semibold uppercase tracking-[0.16em] text-gray-600 ring-1 ring-gray-200 transition hover:bg-gray-50">
          <input
            type="checkbox"
            checked={editActive}
            onChange={(e) => setEditActive(e.target.checked)}
            className="h-4 w-4 rounded-full border-gray-300 text-gray-900"
          />
          Active staff record
        </label>

        {/* Action bar: pill buttons. Primary dark, secondary outline,
            destructive right-aligned. */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button variant="brand" type="button" onClick={handleSave} className="h-11">
            Save
          </Button>
          <Button variant="secondary" type="button" onClick={onCancel} className="h-11">
            Cancel
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={onDelete}
            className="ml-auto h-11 border border-rose-200 text-rose-600 hover:bg-rose-50"
          >
            Deactivate
          </Button>
        </div>
      </div>
    </div>
  );
}
