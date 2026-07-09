'use client';

import { RoleColorPicker } from '../RoleColorPicker';
import { InlineEdit } from './InlineEdit';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import type { RoleDetail } from './role-editor-types';

type Role = RoleDetail['role'];

/** Card A — identity: color, inline-editable label, key (read-only), duplicate, delete. */
export function RoleIdentityCard({
  role,
  isAdminRole,
  busy,
  onPatch,
  onDelete,
  onDuplicate,
}: {
  role: Role;
  isAdminRole: boolean;
  busy: string | null;
  onPatch: (body: Record<string, unknown>, tag: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border-soft bg-surface-card p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="h-14 w-14 flex-shrink-0 rounded-full ring-4 ring-white shadow" style={{ backgroundColor: role.color }} aria-hidden />
        <div className="min-w-0 flex-1">
          <InlineEdit
            value={role.label}
            onSave={(next) => { if (next !== role.label) onPatch({ label: next }, 'label'); }}
            displayClassName="truncate text-2xl font-semibold tracking-tight text-text-default"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="rounded-full bg-surface-sunken px-2 py-0.5 text-micro font-mono text-text-muted">{role.key}</code>
            {role.is_system && (
              <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wider text-text-soft">System</span>
            )}
            {isAdminRole && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wider text-amber-900 ring-1 ring-amber-200">All Access</span>
            )}
            <span className="text-caption text-text-faint">position {role.position}</span>
            <span className="text-caption text-text-faint">· {role.member_count} member{role.member_count === 1 ? '' : 's'}</span>
          </div>
          <div className="mt-3">
            <div className="mb-1.5 text-micro font-semibold uppercase tracking-wider text-text-soft">Color</div>
            <RoleColorPicker
              value={role.color}
              onChange={(hex) => onPatch({ color: hex }, 'color')}
              disabled={busy === 'color'}
            />
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-col gap-1.5">
          <Button variant="secondary" size="sm" onClick={onDuplicate}>
            Duplicate
          </Button>
          <HoverTooltip
            label={role.is_system ? 'System roles cannot be deleted' : role.member_count > 0 ? 'Remove all members first' : 'Delete role'}
            asChild
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={onDelete}
              disabled={role.is_system || role.member_count > 0 || busy === 'delete'}
              className="text-red-700 hover:bg-red-50"
            >
              Delete
            </Button>
          </HoverTooltip>
        </div>
      </div>
    </section>
  );
}
