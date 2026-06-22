'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PermissionString } from '@/lib/auth/permissions-shared';
import type { AuditEntry, RoleDetail, StaffPickerRow } from './role-editor-types';

/**
 * Owns the role editor's data + every mutation: the role-detail fetch, the
 * audit + full-staff loads, role PATCH (label/color/permissions/mobile-defaults),
 * permission toggle, add/remove staff (read-modify-write the staff's role set),
 * delete, and the cross-view refresh broadcast. Returns a controller bag the
 * thin shell + cards render from.
 */
export function useRoleEditor(roleId: number) {
  const [detail, setDetail] = useState<RoleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [allStaff, setAllStaff] = useState<StaffPickerRow[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/admin/roles/${roleId}`, { credentials: 'include', cache: 'no-store' });
      if (!r.ok) {
        setErr(r.status === 401 || r.status === 403 ? "You don't have admin access." : 'Could not load role.');
        return;
      }
      setDetail(await r.json() as RoleDetail);
    } finally {
      setLoading(false);
    }
  }, [roleId]);

  useEffect(() => { setLoading(true); void refresh(); }, [refresh]);

  // Load audit and full staff list once per role open.
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/admin/audit?limit=50`, { credentials: 'include', cache: 'no-store' });
        if (r.ok) {
          const data = await r.json() as { entries: AuditEntry[] };
          const filtered = (data.entries || []).filter((e) => {
            if (!e.event.startsWith('role.') && e.event !== 'staff.roles.changed') return false;
            const d = e.detail as Record<string, unknown>;
            if (d.roleId === roleId) return true;
            if (Array.isArray(d.add)   && (d.add as number[]).includes(roleId))   return true;
            if (Array.isArray(d.remove) && (d.remove as number[]).includes(roleId)) return true;
            return false;
          });
          setAudit(filtered.slice(0, 20));
        }
      } catch { /* ignore */ }
    })();
    void (async () => {
      try {
        const r = await fetch(`/api/admin/staff`, { credentials: 'include', cache: 'no-store' });
        if (r.ok) {
          const data = await r.json() as { staff: StaffPickerRow[] };
          setAllStaff(data.staff || []);
        }
      } catch { /* ignore */ }
    })();
  }, [roleId]);

  const notifyList = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('admin-roles-refresh'));
      // Also notify the access view so per-staff matrices reflect changes.
      window.dispatchEvent(new CustomEvent('admin-access-refresh'));
    }
  }, []);

  const patch = useCallback(async (body: Record<string, unknown>, tag: string) => {
    setBusy(tag); setErr(null);
    try {
      const r = await fetch(`/api/admin/roles/${roleId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        const code = String((data as { error?: string; message?: string }).error || '');
        const msg = String((data as { message?: string }).message || code || 'Save failed.');
        setErr(msg);
        return;
      }
      await refresh();
      notifyList();
    } finally {
      setBusy(null);
    }
  }, [roleId, refresh, notifyList]);

  const togglePermission = useCallback((perm: PermissionString) => {
    if (!detail) return;
    const current = new Set(detail.role.permissions);
    if (current.has(perm)) current.delete(perm); else current.add(perm);
    void patch({ permissions: Array.from(current) }, `perm:${perm}`);
  }, [detail, patch]);

  const patchMobileDefaults = useCallback(async (config: unknown) => {
    setBusy('mobile'); setErr(null);
    try {
      const r = await fetch(`/api/admin/roles/${roleId}/mobile-defaults`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(String((data as { error?: string; message?: string }).message
          || (data as { error?: string }).error || 'Mobile defaults save failed.'));
        return;
      }
      await refresh();
      notifyList();
    } finally {
      setBusy(null);
    }
  }, [roleId, refresh, notifyList]);

  const addStaffToRole = useCallback(async (staffId: number) => {
    setBusy(`add:${staffId}`);
    try {
      // Read current roles for staff, then PUT the union including this one.
      const r = await fetch(`/api/admin/staff/${staffId}/roles`, { credentials: 'include', cache: 'no-store' });
      if (!r.ok) { setErr('Could not load staff roles.'); return; }
      const data = await r.json() as { roles: Array<{ id: number }> };
      const ids = new Set(data.roles.map((rr) => rr.id));
      ids.add(roleId);
      const put = await fetch(`/api/admin/staff/${staffId}/roles`, {
        method: 'PUT', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roleIds: Array.from(ids) }),
      });
      if (!put.ok) { setErr('Could not assign role.'); return; }
      await refresh();
      notifyList();
    } finally {
      setBusy(null);
    }
  }, [roleId, refresh, notifyList]);

  const removeStaffFromRole = useCallback(async (staffId: number) => {
    if (!confirm('Remove this staff from the role?')) return;
    setBusy(`remove:${staffId}`);
    try {
      const r = await fetch(`/api/admin/staff/${staffId}/roles`, { credentials: 'include', cache: 'no-store' });
      if (!r.ok) { setErr('Could not load staff roles.'); return; }
      const data = await r.json() as { roles: Array<{ id: number }> };
      const ids = data.roles.map((rr) => rr.id).filter((id) => id !== roleId);
      const put = await fetch(`/api/admin/staff/${staffId}/roles`, {
        method: 'PUT', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roleIds: ids }),
      });
      if (!put.ok) { setErr('Could not update assignment.'); return; }
      await refresh();
      notifyList();
    } finally {
      setBusy(null);
    }
  }, [roleId, refresh, notifyList]);

  const deleteRole = useCallback(async () => {
    if (!detail) return;
    if (!confirm(`Delete the role "${detail.role.label}"? This cannot be undone.`)) return;
    setBusy('delete');
    try {
      const r = await fetch(`/api/admin/roles/${roleId}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(String((data as { message?: string; error?: string }).message || (data as { error?: string }).error || 'Could not delete role.'));
        return;
      }
      notifyList();
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        params.delete('roleId');
        window.history.replaceState(null, '', `/admin?${params.toString()}`);
      }
    } finally {
      setBusy(null);
    }
  }, [detail, roleId, notifyList]);

  const eligibleStaff = useMemo(() => {
    if (!detail || !allStaff) return [];
    const memberIds = new Set(detail.members.map((m) => m.id));
    return allStaff.filter((s) => !memberIds.has(s.id));
  }, [detail, allStaff]);

  return {
    detail, loading, err, busy,
    duplicateOpen, setDuplicateOpen,
    audit, eligibleStaff,
    notifyList, patch, togglePermission, patchMobileDefaults,
    addStaffToRole, removeStaffFromRole, deleteRole,
  };
}

export type RoleEditorController = ReturnType<typeof useRoleEditor>;
