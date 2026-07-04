'use client';

import { AddRolePopover } from '../AddRolePopover';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import type { RoleSlim } from '../staff-access-shared';

interface RolesCardProps {
  roles: RoleSlim[];
  availableRoles: RoleSlim[];
  borderClass: string;
  busyRoles: boolean;
  onSetRoles: (roleIds: number[]) => void;
}

export function RolesCard({ roles, availableRoles, borderClass, busyRoles, onSetRoles }: RolesCardProps) {
  return (
    <section className={`overflow-hidden rounded-2xl border ${borderClass} bg-surface-card shadow-sm`}>
      <header className="flex items-center justify-between border-b border-border-hairline px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-text-default">Roles</h2>
          <p className="mt-0.5 text-caption text-text-soft">
            Staff can hold many roles. Effective permissions = UNION of every role&apos;s set,
            then layered with the per-page overrides below.
          </p>
        </div>
        <div className="text-caption text-text-soft">
          {roles.length} role{roles.length === 1 ? '' : 's'}
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-1.5 px-5 py-3">
        {roles.map((r, idx) => (
          <span
            key={r.id}
            className="group inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-semibold ring-1 ring-inset"
            style={{ backgroundColor: `${r.color}1A`, color: r.color, borderColor: `${r.color}33` }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
            {r.label}
            {idx === 0 && roles.length > 1 && (
              <HoverTooltip label="Primary role (highest position). Shown in the Identity card." asChild>
                <span
                  className="ml-0.5 rounded-sm px-1 py-px text-eyebrow font-bold uppercase tracking-wider opacity-70"
                  style={{ backgroundColor: `${r.color}26` }}
                >
                  primary
                </span>
              </HoverTooltip>
            )}
            {!r.is_system || roles.length > 1 ? (
              <IconButton
                type="button"
                onClick={() => onSetRoles(roles.filter((x) => x.id !== r.id).map((x) => x.id))}
                disabled={busyRoles}
                ariaLabel={`Remove role ${r.label}`}
                className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-current opacity-60 transition hover:bg-white/40 hover:opacity-100"
                icon={<svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>}
              />
            ) : null}
          </span>
        ))}
        {roles.length === 0 && (
          <span className="text-caption italic text-text-faint">No roles assigned — staff has no role-granted permissions.</span>
        )}
        <AddRolePopover
          roles={availableRoles.filter((r) => !roles.some((x) => x.id === r.id))}
          onAdd={(roleId) => onSetRoles([...roles.map((r) => r.id), roleId])}
          disabled={busyRoles}
        />
      </div>
      <div className="border-t border-border-hairline bg-surface-canvas/60 px-5 py-2 text-micro text-text-muted">
        Primary role: <b>{roles[0]?.label ?? '—'}</b>
        {roles.length > 1 && ` · ${roles.length - 1} additional`}
        {' · '}
        <span className="text-text-soft">Edit role permissions in <a href="/settings/roles" className="text-blue-600 hover:underline">Roles</a>.</span>
      </div>
    </section>
  );
}
