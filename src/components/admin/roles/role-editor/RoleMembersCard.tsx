'use client';

import type { RoleDetail, StaffPickerRow } from './role-editor-types';

/** Card C — members: staff who hold this role + add/remove. */
export function RoleMembersCard({
  members,
  eligibleStaff,
  busy,
  onAdd,
  onRemove,
}: {
  members: RoleDetail['members'];
  eligibleStaff: StaffPickerRow[];
  busy: string | null;
  onAdd: (staffId: number) => void;
  onRemove: (staffId: number) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Members</h2>
          <p className="mt-0.5 text-caption text-gray-500">{members.length} staff hold this role.</p>
        </div>
      </header>
      <ul className="divide-y divide-gray-100">
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between px-5 py-2">
            <div>
              <div className="text-sm font-semibold text-gray-900">{m.name} <span className="text-micro text-gray-400">#{m.id}</span></div>
              <div className="text-caption text-gray-500">primary role: {m.role}</div>
            </div>
            <button
              type="button"
              onClick={() => void onRemove(m.id)}
              disabled={busy === `remove:${m.id}`}
              className="rounded-md border border-red-200 px-2 py-1 text-micro font-semibold uppercase tracking-wider text-red-700 hover:bg-red-50"
            >
              Remove
            </button>
          </li>
        ))}
        {members.length === 0 && (
          <li className="px-5 py-6 text-center text-caption text-gray-400">No members yet.</li>
        )}
      </ul>
      {eligibleStaff.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-3">
          <details>
            <summary className="cursor-pointer text-label font-semibold text-gray-700 hover:text-gray-900">
              + Add staff to role ({eligibleStaff.length} eligible)
            </summary>
            <ul className="mt-2 max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100">
              {eligibleStaff.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-xs text-gray-800">{s.name} <span className="text-micro text-gray-400">· {s.role}</span></span>
                  <button
                    type="button"
                    onClick={() => void onAdd(s.id)}
                    disabled={busy === `add:${s.id}`}
                    className="rounded-md border border-gray-200 px-2 py-0.5 text-micro font-semibold uppercase tracking-wider text-gray-700 hover:bg-gray-50"
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
