'use client';

import { Button } from '@/design-system/primitives';
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
    <section className="overflow-hidden rounded-2xl border border-border-soft bg-surface-card shadow-sm">
      <header className="flex items-center justify-between border-b border-border-hairline px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-text-default">Members</h2>
          <p className="mt-0.5 text-caption text-text-soft">{members.length} staff hold this role.</p>
        </div>
      </header>
      <ul className="divide-y divide-border-hairline">
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between px-5 py-2">
            <div>
              <div className="text-sm font-semibold text-text-default">{m.name} <span className="text-micro text-text-faint">#{m.id}</span></div>
              <div className="text-caption text-text-soft">primary role: {m.role}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => void onRemove(m.id)}
              disabled={busy === `remove:${m.id}`}
              className="border border-red-200 text-red-700 hover:bg-red-50 hover:text-red-700"
            >
              Remove
            </Button>
          </li>
        ))}
        {members.length === 0 && (
          <li className="px-5 py-6 text-center text-caption text-text-faint">No members yet.</li>
        )}
      </ul>
      {eligibleStaff.length > 0 && (
        <div className="border-t border-border-hairline px-5 py-3">
          <details>
            <summary className="cursor-pointer text-label font-semibold text-text-muted hover:text-text-default">
              + Add staff to role ({eligibleStaff.length} eligible)
            </summary>
            <ul className="mt-2 max-h-64 divide-y divide-border-hairline overflow-y-auto rounded-lg border border-border-hairline">
              {eligibleStaff.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-xs text-text-default">{s.name} <span className="text-micro text-text-faint">· {s.role}</span></span>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => void onAdd(s.id)}
                    disabled={busy === `add:${s.id}`}
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
