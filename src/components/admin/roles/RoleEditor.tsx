'use client';

/**
 * Settings → Roles&roleId=N — Discord-style role editor.
 *
 * Four cards (single column, max-w-3xl):
 *   A. Identity      — color, inline-editable label, key (read-only), duplicate, delete
 *   B. Permissions   — toggle grid grouped by PERMISSION_CATEGORIES
 *   C. Members       — staff who hold this role + add/remove
 *   D. Recent audit  — role.* + staff.roles.changed entries
 *
 * Thin composition shell: data + every mutation live in {@link useRoleEditor};
 * each card is a presentational component under `./role-editor/`.
 */

import { DuplicateRoleDialog } from './DuplicateRoleDialog';
import { useRoleEditor } from './role-editor/useRoleEditor';
import type { RoleEditorProps } from './role-editor/role-editor-types';
import { RoleIdentityCard } from './role-editor/RoleIdentityCard';
import { RolePermissionsSection } from './role-editor/RolePermissionsSection';
import { RoleMobileDefaultsCard } from './role-editor/RoleMobileDefaultsCard';
import { RoleMembersCard } from './role-editor/RoleMembersCard';
import { RoleAuditCard } from './role-editor/RoleAuditCard';

export function RoleEditor({ roleId }: RoleEditorProps) {
  const c = useRoleEditor(roleId);
  const { detail, loading, err, busy } = c;

  if (loading) return <div className="p-8 text-center text-sm text-text-soft">Loading role…</div>;
  if (err && !detail) return <div className="m-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>;
  if (!detail) return null;

  const { role, members } = detail;
  const isAdminRole = role.key === 'admin';
  const enabledSet = new Set(role.permissions);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <RoleIdentityCard
        role={role}
        isAdminRole={isAdminRole}
        busy={busy}
        onPatch={c.patch}
        onDelete={() => void c.deleteRole()}
        onDuplicate={() => c.setDuplicateOpen(true)}
      />

      <RolePermissionsSection
        roleColor={role.color}
        isAdminRole={isAdminRole}
        enabledSet={enabledSet}
        busy={busy}
        onToggle={c.togglePermission}
      />

      <RoleMobileDefaultsCard
        roleLabel={role.label}
        roleColor={role.color}
        mobileDefaults={role.mobile_defaults}
        busy={busy === 'mobile'}
        onSave={(config) => void c.patchMobileDefaults(config)}
        onReset={() => void c.patchMobileDefaults(null)}
      />

      <RoleMembersCard
        members={members}
        eligibleStaff={c.eligibleStaff}
        busy={busy}
        onAdd={c.addStaffToRole}
        onRemove={c.removeStaffFromRole}
      />

      <RoleAuditCard audit={c.audit} />

      <DuplicateRoleDialog
        open={c.duplicateOpen}
        sourceRoleId={roleId}
        sourceLabel={role.label}
        onClose={() => c.setDuplicateOpen(false)}
        onDuplicated={(newId) => {
          c.notifyList();
          if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            params.set('roleId', String(newId));
            window.history.replaceState(null, '', `/admin?${params.toString()}`);
            window.location.reload();
          }
        }}
      />
    </div>
  );
}
