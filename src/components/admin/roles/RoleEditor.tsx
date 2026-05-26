'use client';

/**
 * /admin?section=roles&roleId=N — Discord-style role editor.
 *
 * Four cards (single column, max-w-3xl):
 *   A. Identity      — color, inline-editable label, key (read-only), duplicate, delete
 *   B. Permissions   — toggle grid grouped by PERMISSION_CATEGORIES
 *   C. Members       — staff who hold this role + add/remove
 *   D. Recent audit  — role.* + staff.roles.changed entries
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PERMISSION_CATEGORIES, type PermissionString } from '@/lib/auth/permissions-shared';
import { APP_SIDEBAR_NAV } from '@/lib/sidebar-navigation';
import {
  DEFAULT_MOBILE_DISPLAY_CONFIG,
  MOBILE_NAV_TAB_IDS,
  sanitizeMobileDisplayConfig,
  type MobileNavTabId,
} from '@/lib/auth/mobile-display-config';
import { PermissionToggle } from './PermissionToggle';
import { DuplicateRoleDialog } from './DuplicateRoleDialog';
import { RoleColorPicker } from './RoleColorPicker';

interface RoleDetail {
  role: {
    id: number;
    key: string;
    label: string;
    color: string;
    position: number;
    permissions: string[];
    is_system: boolean;
    mobile_defaults: unknown;
    created_at: string;
    updated_at: string;
    member_count: number;
  };
  members: Array<{
    id: number;
    name: string;
    role: string;
    status: string;
    granted_at: string;
    granted_by: number | null;
  }>;
}

interface StaffPickerRow {
  id: number;
  name: string;
  role: string;
  status: string;
}

interface RoleEditorProps {
  roleId: number;
}

export function RoleEditor({ roleId }: RoleEditorProps) {
  const [detail, setDetail] = useState<RoleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [allStaff, setAllStaff] = useState<StaffPickerRow[] | null>(null);
  const [audit, setAudit] = useState<Array<{ id: number; event: string; result: string; created_at: string; detail: Record<string, unknown> }>>([]);

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
          const data = await r.json() as { entries: typeof audit };
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

  if (loading) return <div className="p-8 text-center text-sm text-gray-500">Loading role…</div>;
  if (err && !detail) return <div className="m-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>;
  if (!detail) return null;

  const { role, members } = detail;
  const isAdminRole = role.key === 'admin';
  const enabledSet = new Set(role.permissions);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {/* Card A — Identity */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 flex-shrink-0 rounded-full ring-4 ring-white shadow" style={{ backgroundColor: role.color }} aria-hidden />
          <div className="min-w-0 flex-1">
            <InlineEdit
              value={role.label}
              onSave={(next) => { if (next !== role.label) void patch({ label: next }, 'label'); }}
              displayClassName="truncate text-2xl font-semibold tracking-tight text-gray-900"
            />
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="rounded-full bg-gray-100 px-2 py-0.5 text-micro font-mono text-gray-600">{role.key}</code>
              {role.is_system && (
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wider text-gray-500">System</span>
              )}
              {isAdminRole && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wider text-amber-900 ring-1 ring-amber-200">All Access</span>
              )}
              <span className="text-caption text-gray-400">position {role.position}</span>
              <span className="text-caption text-gray-400">· {role.member_count} member{role.member_count === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-3">
              <div className="mb-1.5 text-micro font-semibold uppercase tracking-wider text-gray-500">Color</div>
              <RoleColorPicker
                value={role.color}
                onChange={(hex) => void patch({ color: hex }, 'color')}
                disabled={busy === 'color'}
              />
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setDuplicateOpen(true)}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-caption font-semibold uppercase tracking-wider text-gray-700 hover:bg-gray-50"
            >
              Duplicate
            </button>
            <button
              type="button"
              onClick={deleteRole}
              disabled={role.is_system || role.member_count > 0 || busy === 'delete'}
              title={role.is_system ? 'System roles cannot be deleted' : role.member_count > 0 ? 'Remove all members first' : 'Delete role'}
              className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-caption font-semibold uppercase tracking-wider text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      </section>

      {/* Card B.0 — .access shortcut (per-page view toggles) */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">.access</h2>
            <p className="mt-0.5 text-caption text-gray-500">
              Quick-toggle which sidebar pages this role can see. Each toggle flips the matching <code className="font-mono">.view</code> permission below.
            </p>
          </div>
        </header>
        <ul className="divide-y divide-gray-100">
          {APP_SIDEBAR_NAV.filter((item) => item.requires).map((item) => {
            const perm = item.requires as PermissionString;
            const enabled = isAdminRole || enabledSet.has(perm);
            return (
              <PermissionToggle
                key={item.id}
                label={item.label}
                permission={perm}
                enabled={enabled}
                color={role.color}
                disabled={isAdminRole || busy === `perm:${perm}`}
                onToggle={() => togglePermission(perm)}
              />
            );
          })}
        </ul>
      </section>

      {/* Card B — Permissions */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Permissions</h2>
            <p className="mt-0.5 text-caption text-gray-500">
              {isAdminRole
                ? 'Admin role grants every permission and cannot be customised.'
                : `Toggle what staff in this role can do. ${enabledSet.size} of many enabled.`}
            </p>
          </div>
        </header>
        {PERMISSION_CATEGORIES.map((cat) => (
          <div key={cat.id} className="border-b border-gray-100 last:border-b-0">
            <div className="bg-gray-50/60 px-5 py-2 text-micro font-bold uppercase tracking-widest text-gray-500">{cat.label}</div>
            <ul className="divide-y divide-gray-100">
              {cat.permissions.map((perm) => (
                <PermissionToggle
                  key={perm}
                  label={perm.replace(/^[a-z_]+\./, '').replace(/_/g, ' ')}
                  permission={perm}
                  enabled={isAdminRole || enabledSet.has(perm)}
                  color={role.color}
                  disabled={isAdminRole || busy === `perm:${perm}`}
                  onToggle={() => togglePermission(perm)}
                />
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* Card B.5 — Mobile defaults */}
      <RoleMobileDefaultsCard
        roleLabel={role.label}
        roleColor={role.color}
        mobileDefaults={role.mobile_defaults}
        busy={busy === 'mobile'}
        onSave={(config) => void patchMobileDefaults(config)}
        onReset={() => void patchMobileDefaults(null)}
      />

      {/* Card C — Members */}
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
                onClick={() => void removeStaffFromRole(m.id)}
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
                      onClick={() => void addStaffToRole(s.id)}
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

      {/* Card D — Recent audit */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Recent activity</h2>
            <p className="mt-0.5 text-caption text-gray-500">Last 20 changes touching this role.</p>
          </div>
        </header>
        {audit.length === 0 ? (
          <p className="px-5 py-6 text-center text-caption text-gray-400">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {audit.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-2 text-caption">
                <span className="font-mono text-gray-700">{a.event}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wider ring-1 ring-inset ${
                  a.result === 'ok' ? 'bg-green-100 text-green-800 ring-green-200'
                  : a.result === 'denied' ? 'bg-amber-100 text-amber-800 ring-amber-200'
                  : 'bg-red-100 text-red-800 ring-red-200'
                }`}>{a.result}</span>
                <span className="text-gray-500">{new Date(a.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DuplicateRoleDialog
        open={duplicateOpen}
        sourceRoleId={roleId}
        sourceLabel={role.label}
        onClose={() => setDuplicateOpen(false)}
        onDuplicated={(newId) => {
          notifyList();
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

// ─── Mobile defaults card ───────────────────────────────────────────────
//
// Sets the role-level mobile UI defaults. Every staff with this role
// inherits these values unless they have a per-staff override (set from
// /admin?section=access). "Reset" clears the role's defaults; the
// resolver then falls back to the system defaults (bottom nav disabled).

const TAB_LABELS: Record<MobileNavTabId, string> = {
  home: 'Home',
  scan: 'Scan (centre)',
  picks: 'Picks',
  signout: 'Sign out',
};

interface RoleMobileDefaultsCardProps {
  roleLabel: string;
  roleColor: string;
  mobileDefaults: unknown;
  busy: boolean;
  onSave: (config: unknown) => void;
  onReset: () => void;
}

function RoleMobileDefaultsCard({ roleLabel, roleColor, mobileDefaults, busy, onSave, onReset }: RoleMobileDefaultsCardProps) {
  const sanitized = useMemo(() => sanitizeMobileDisplayConfig(mobileDefaults), [mobileDefaults]);
  const hasDefaults = sanitized !== null;

  // Show whichever value the role currently has set; fall back to the
  // hard-coded system default when this role hasn't set anything.
  const currentEnabled = sanitized?.bottomNav?.enabled ?? DEFAULT_MOBILE_DISPLAY_CONFIG.bottomNav.enabled;
  const currentTabs: MobileNavTabId[] = sanitized?.bottomNav?.tabs
    ? [...sanitized.bottomNav.tabs]
    : [...DEFAULT_MOBILE_DISPLAY_CONFIG.bottomNav.tabs];

  const [draftEnabled, setDraftEnabled] = useState(currentEnabled);
  const [draftTabs, setDraftTabs] = useState<MobileNavTabId[]>(currentTabs);

  useEffect(() => {
    setDraftEnabled(currentEnabled);
    setDraftTabs(currentTabs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileDefaults]);

  const toggleTab = (id: MobileNavTabId) => {
    setDraftTabs((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  };

  const dirty =
    draftEnabled !== currentEnabled ||
    draftTabs.length !== currentTabs.length ||
    draftTabs.some((t, i) => t !== currentTabs[i]);

  const save = () => {
    onSave({
      bottomNav: {
        enabled: draftEnabled,
        tabs: draftTabs.length > 0 ? draftTabs : ['scan'],
      },
    });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Mobile defaults</h2>
          <p className="mt-0.5 text-caption text-gray-500">
            Every staff with the <b style={{ color: roleColor }}>{roleLabel}</b> role inherits these — unless overridden in <a href="/admin?section=access" className="text-blue-600 hover:underline">Access</a>.
          </p>
        </div>
        {hasDefaults && (
          <button
            type="button"
            onClick={onReset}
            disabled={busy}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-caption font-semibold uppercase tracking-wider text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title="Clear role defaults; staff fall back to system default"
          >
            Reset
          </button>
        )}
      </header>

      <div className="space-y-4 px-5 py-4">
        <label className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">Bottom navigation bar</div>
            <p className="mt-0.5 text-caption text-gray-500">
              When off, staff in this role are locked to a single page on their phone.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draftEnabled}
            onClick={() => setDraftEnabled((v) => !v)}
            disabled={busy}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
              draftEnabled ? 'bg-blue-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                draftEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </label>

        <div>
          <div className="text-sm font-semibold text-gray-900">Tabs</div>
          <p className="mb-2 mt-0.5 text-caption text-gray-500">
            Tap to toggle. Scan stays centre and raised when included.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MOBILE_NAV_TAB_IDS.map((id) => {
              const on = draftTabs.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleTab(id)}
                  disabled={busy || !draftEnabled}
                  className={`rounded-full px-2.5 py-1 text-caption font-semibold ring-1 ring-inset transition ${
                    on
                      ? 'bg-blue-100 text-blue-800 ring-blue-300'
                      : 'bg-gray-50 text-gray-500 ring-gray-200 hover:bg-gray-100'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {TAB_LABELS[id]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
          <div className="text-micro text-gray-500">
            {hasDefaults ? 'Role defaults active.' : 'No defaults set — using system default.'}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-caption font-semibold uppercase tracking-wider text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving…' : dirty ? 'Save defaults' : 'Saved'}
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── Inline edit ────────────────────────────────────────────────────────

function InlineEdit({ value, onSave, displayClassName }: { value: string; onSave: (next: string) => void; displayClassName: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className={`group ${displayClassName} text-left hover:underline`}>
        {value}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onSave(draft.trim() || value); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onSave(draft.trim() || value); setEditing(false); }
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
        className="h-9 min-w-[200px] flex-1 rounded-md border border-gray-300 px-2 text-base font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
      />
    </div>
  );
}
