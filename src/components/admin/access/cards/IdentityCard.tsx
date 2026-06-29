'use client';

import { useEffect, useState } from 'react';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import { STATUS_OPTIONS, type DetailEnvelope, type RoleSlim } from '../staff-access-shared';
import { initials } from '../staff-access-shared';

interface IdentityCardProps {
  staff: DetailEnvelope['staff'];
  roles: RoleSlim[];
  availableRoles: RoleSlim[];
  isAdmin: boolean;
  borderClass: string;
  avatarBgClass: string;
  busyBasic: boolean;
  busyRoles: boolean;
  onPatchBasic: (patch: Record<string, unknown>) => void;
  onSetRoles: (roleIds: number[]) => void;
}

export function IdentityCard({
  staff, roles, availableRoles, isAdmin, borderClass, avatarBgClass,
  busyBasic, busyRoles, onPatchBasic, onSetRoles,
}: IdentityCardProps) {
  const primaryRole = roles[0];

  return (
    <section className={`rounded-2xl border ${borderClass} bg-white p-5 shadow-sm`}>
      <div className="flex items-start gap-4">
        <div className={`relative flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full ${avatarBgClass} text-xl font-bold text-white ring-4 ring-white shadow`}>
          {initials(staff.name)}
          {isAdmin && (
            // ds-allow-title (reviewed: absolutely-positioned badge)
            <span className="absolute -bottom-1 -right-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 ring-2 ring-white" title="Admin · All Access">
              <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <InlineNameAndCode
            name={staff.name}
            code={staff.employee_code ?? ''}
            onSave={(name, code) => onPatchBasic({
              ...(name !== staff.name ? { name } : {}),
              ...((code || null) !== (staff.employee_code ?? null) ? { employeeCode: code || null } : {}),
            })}
          />
          <div className="mt-1 flex items-center gap-2">
            <span className="text-caption text-gray-400">#{staff.id}</span>
            {isAdmin && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wider text-amber-900 ring-1 ring-amber-200">
                All Access
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {/* Primary role — selecting REPLACES this staffer's entire role set
                with the chosen one. staff.role is mirrored server-side. */}
            <label className="inline-flex items-center gap-2">
              <span className="text-micro font-semibold uppercase tracking-wider text-gray-500">Primary</span>
              <HoverTooltip label="Replaces this staffer's roles with the selected one." asChild>
                <select
                  value={primaryRole?.id ?? ''}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (Number.isFinite(id) && id > 0) onSetRoles([id]);
                  }}
                  disabled={busyRoles}
                  className="h-7 rounded-full bg-gray-100 px-2.5 text-micro font-bold uppercase tracking-wider text-gray-700 outline-none ring-1 ring-gray-200 transition disabled:opacity-60"
                  style={primaryRole ? { color: primaryRole.color } : undefined}
                >
                  {!primaryRole && <option value="">no roles</option>}
                  {[...availableRoles, ...roles]
                    .filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i)
                    .sort((a, b) => a.position - b.position)
                    .map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                </select>
              </HoverTooltip>
            </label>
            <label className="inline-flex items-center gap-2">
              <span className="text-micro font-semibold uppercase tracking-wider text-gray-500">Status</span>
              <select
                value={STATUS_OPTIONS.includes(staff.status as typeof STATUS_OPTIONS[number]) ? staff.status : 'active'}
                onChange={(e) => onPatchBasic({ status: e.target.value })}
                disabled={busyBasic}
                className="h-7 rounded-full bg-gray-100 px-2.5 text-micro font-bold uppercase tracking-wider text-gray-700 outline-none ring-1 ring-gray-200 transition"
              >
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Inline name + employee_code editor ─────────────────────────────────

function InlineNameAndCode({ name, code, onSave }: {
  name: string;
  code: string;
  onSave: (name: string, code: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftCode, setDraftCode] = useState(code);

  useEffect(() => { setDraftName(name); setDraftCode(code); }, [name, code]);

  if (!editing) {
    return (
      // ds-raw-button
      <button type="button" onClick={() => setEditing(true)} className="group flex flex-wrap items-baseline gap-2 text-left">
        <span className="truncate text-2xl font-semibold tracking-tight text-gray-900 group-hover:underline">{name}</span>
        {code && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-micro font-semibold uppercase tracking-wider text-gray-600">{code}</span>}
        <span className="text-micro text-blue-600 opacity-0 transition group-hover:opacity-100">Edit</span>
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)}
        className="h-9 min-w-[180px] flex-1 rounded-md border border-gray-300 px-2 text-base font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15" />
      <input value={draftCode} onChange={(e) => setDraftCode(e.target.value)} placeholder="Employee code"
        className="h-9 w-36 rounded-md border border-gray-300 px-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15" />
      <Button variant="brand" size="md" onClick={() => { onSave(draftName.trim() || name, draftCode.trim()); setEditing(false); }}>
        Save
      </Button>
      <Button variant="secondary" size="md" onClick={() => { setDraftName(name); setDraftCode(code); setEditing(false); }}>
        Cancel
      </Button>
    </div>
  );
}
