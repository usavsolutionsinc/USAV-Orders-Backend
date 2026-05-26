'use client';

/**
 * /admin?section=access&staffId=N — focused detail view for one staff.
 *
 * Four cards (single column, max-w-3xl):
 *   A. Identity      — avatar, name (inline edit), role, status, employee code
 *   B. Page access   — per-page toggles backed by permissions_added/removed
 *   C. Credentials   — PIN reset/update, passkeys + sessions revoke
 *   D. Audit         — last 20 auth_audit rows
 *
 * The component owns its own detail envelope (one fetch from
 * /api/admin/staff/[id]/detail). After any mutation it dispatches
 * `admin-access-refresh` so the sidebar list also re-fetches.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import {
  ALL_ROLES,
  isAdminRoleKey,
  type PermissionString,
  type StaffRole,
} from '@/lib/auth/permissions-shared';

/**
 * Classify a permission for the admin badge column: where does the current
 * effective state come from?
 *   - 'role'        : granted by an assigned role
 *   - 'revoked'     : granted by role but explicitly removed via override
 *   - 'granted'     : not in any role; granted via override
 *   - 'role-denies' : not in any role and no override (effective: off)
 *
 * Computed against the DB-sourced role permission set (passed in) — not the
 * static seed matrix. This is the replacement for the old static-matrix
 * `permissionSource()` helper.
 */
type PermissionSource = 'role' | 'granted' | 'revoked' | 'role-denies';
function classifyPermissionSource(
  inRole: boolean,
  isAdded: boolean,
  isRemoved: boolean,
): PermissionSource {
  if (inRole && isRemoved) return 'revoked';
  if (inRole) return 'role';
  if (isAdded) return 'granted';
  return 'role-denies';
}
import { APP_SIDEBAR_NAV } from '@/lib/sidebar-navigation';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import {
  MOBILE_NAV_TAB_IDS,
  resolveMobileDisplayConfig,
  sanitizeMobileDisplayConfig,
  type MobileDisplayConfig,
  type MobileNavTabId,
} from '@/lib/auth/mobile-display-config';
import { PageAccessSwitch } from './PageAccessSwitch';
import { SetPinDialog } from './SetPinDialog';
import { AddRolePopover } from './AddRolePopover';

interface DetailEnvelope {
  staff: {
    id: number;
    name: string;
    role: string;
    status: string;
    active: boolean;
    employee_id: string | null;
    employee_code: string | null;
    permissions_added: string[];
    permissions_removed: string[];
    mobile_display_config: unknown;
    has_pin: boolean;
    pin_set_at: string | null;
    pin_locked_until: string | null;
    last_login_at: string | null;
    created_at: string;
  };
  passkeys: Array<{
    id: number;
    device_label: string | null;
    last_used_at: string | null;
    created_at: string;
  }>;
  sessions: Array<{
    sid: string;
    device_kind: string;
    device_label: string | null;
    ip: string | null;
    created_at: string;
    last_seen_at: string;
    expires_at: string;
  }>;
  audit: Array<{
    id: number;
    event: string;
    result: string;
    ip: string | null;
    sid: string | null;
    detail: Record<string, unknown>;
    created_at: string;
  }>;
  roles: RoleSlim[];
  availableRoles: RoleSlim[];
}

interface RoleSlim {
  id: number;
  key: string;
  label: string;
  color: string;
  position: number;
  permissions: string[];
  is_system: boolean;
  mobile_defaults?: unknown;
}

const STATUS_OPTIONS = ['active', 'invited', 'suspended', 'disabled'] as const;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function fmtRelative(when: string | null | undefined): string {
  if (!when) return '—';
  const ms = Date.now() - new Date(when).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface StaffAccessDetailProps { staffId: number }

export function StaffAccessDetail({ staffId }: StaffAccessDetailProps) {
  const [envelope, setEnvelope] = useState<DetailEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<{ url: string; expiresAt: string } | null>(null);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/admin/staff/${staffId}/detail`, { credentials: 'include', cache: 'no-store' });
      if (!r.ok) {
        setErr(r.status === 401 || r.status === 403 ? "You don't have admin access." : 'Could not load staff.');
        return;
      }
      setEnvelope(await r.json() as DetailEnvelope);
    } finally {
      setLoading(false);
    }
  }, [staffId]);

  useEffect(() => { setLoading(true); void refresh(); }, [refresh]);

  const notifyList = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('admin-access-refresh'));
    }
  }, []);

  const patchBasic = useCallback(async (patch: Record<string, unknown>) => {
    setBusy('basic');
    try {
      const r = await fetch(`/api/admin/staff/${staffId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(String((data as { error?: string }).error || 'Save failed.'));
        return;
      }
      await refresh();
      notifyList();
    } finally {
      setBusy(null);
    }
  }, [staffId, refresh, notifyList]);

  const patchPermissions = useCallback(async (next: { add: string[]; remove: string[] }) => {
    setBusy(`perm:${next.add.length}:${next.remove.length}`);
    try {
      const r = await fetch(`/api/admin/staff/${staffId}/permissions`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(String((data as { error?: string }).error || 'Permission save failed.'));
        return;
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [staffId, refresh]);

  const setStaffRoles = useCallback(async (roleIds: number[]) => {
    setBusy(`roles:${roleIds.join(',')}`);
    try {
      const r = await fetch(`/api/admin/staff/${staffId}/roles`, {
        method: 'PUT', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roleIds }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(String((data as { error?: string }).error || 'Role assignment failed.'));
        return;
      }
      await refresh();
      notifyList();
    } finally {
      setBusy(null);
    }
  }, [staffId, refresh, notifyList]);

  const resetPin = useCallback(async () => {
    if (!confirm('Reset this staff\'s PIN and send them an enrollment QR?')) return;
    setBusy('reset-pin');
    try {
      const r = await fetch(`/api/admin/staff/${staffId}/reset-pin`, {
        method: 'POST', credentials: 'include',
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(String((data as { error?: string }).error || 'Reset failed.'));
        return;
      }
      const data = await r.json() as { url: string; expiresAt: string };
      setQrUrl({ url: data.url, expiresAt: data.expiresAt });
      await refresh();
      notifyList();
    } finally {
      setBusy(null);
    }
  }, [staffId, refresh, notifyList]);

  const revokePasskey = useCallback(async (pid: number) => {
    if (!confirm('Revoke this passkey?')) return;
    setBusy(`pk:${pid}`);
    try {
      await fetch(`/api/admin/staff/${staffId}/passkeys/${pid}`, { method: 'DELETE', credentials: 'include' });
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [staffId, refresh]);

  const revokeSession = useCallback(async (sid: string) => {
    if (!confirm('Revoke this session?')) return;
    setBusy(`ses:${sid}`);
    try {
      await fetch(`/api/admin/sessions/${encodeURIComponent(sid)}`, { method: 'DELETE', credentials: 'include' });
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [staffId, refresh]);

  const revokeAllSessions = useCallback(async () => {
    if (!confirm('Revoke ALL active sessions for this staff?')) return;
    setBusy('ses:all');
    try {
      await fetch(`/api/admin/staff/${staffId}/sessions`, { method: 'DELETE', credentials: 'include' });
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [staffId, refresh]);

  const patchMobileConfig = useCallback(async (config: unknown) => {
    setBusy('mobile');
    try {
      const r = await fetch(`/api/admin/staff/${staffId}/mobile-display-config`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(String((data as { error?: string }).error || 'Mobile save failed.'));
        return;
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [staffId, refresh]);

  if (loading) return <div className="p-8 text-center text-sm text-gray-500">Loading staff…</div>;
  if (err) return <div className="m-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>;
  if (!envelope) return null;

  const { staff, passkeys, sessions, audit } = envelope;
  const theme = getStaffThemeById(staff.id);
  const sc = stationThemeColors[theme];
  const role = staff.role as StaffRole;
  // Admin short-circuit covers both the legacy single-role column AND any
  // assigned role with key='admin' (multi-role staff).
  const isAdmin = isAdminRoleKey(role) || envelope.roles.some((r) => isAdminRoleKey(r.key));
  const added = staff.permissions_added ?? [];
  const removed = staff.permissions_removed ?? [];

  // Union of every assigned role's DB permissions. This replaces the previous
  // static-matrix `permissionsSetForRole(role)` lookup — the source of truth
  // is the `roles.permissions` column, not the seed in code.
  const roleDbPermissions = new Set<string>();
  for (const r of envelope.roles) {
    for (const p of r.permissions) roleDbPermissions.add(p);
  }

  const pagePerms = APP_SIDEBAR_NAV.filter((item) => item.requires);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
      {/* Card A — Identity */}
      <section className={`rounded-2xl border ${sc.border} bg-white p-5 shadow-sm`}>
        <div className="flex items-start gap-4">
          <div className={`relative flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full ${sc.bg} text-xl font-bold text-white ring-4 ring-white shadow`}>
            {initials(staff.name)}
            {isAdmin && (
              <span className="absolute -bottom-1 -right-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 ring-2 ring-white" title="Admin · All Access">
                <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <InlineNameAndCode
              name={staff.name}
              code={staff.employee_code ?? ''}
              onSave={(name, code) => patchBasic({
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
              <label className="inline-flex items-center gap-2">
                <span className="text-micro font-semibold uppercase tracking-wider text-gray-500">Role</span>
                <select
                  value={ALL_ROLES.includes(role as typeof ALL_ROLES[number]) ? role : ALL_ROLES[0]}
                  onChange={(e) => void patchBasic({ role: e.target.value })}
                  disabled={busy === 'basic'}
                  className={`h-8 rounded-lg border ${sc.border} ${sc.light} px-2 text-label font-semibold ${sc.text} outline-none transition hover:bg-white focus:border-gray-300 focus:bg-white`}
                >
                  {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  {!ALL_ROLES.includes(role as typeof ALL_ROLES[number]) && (
                    <option value={role}>{role} (legacy)</option>
                  )}
                </select>
              </label>
              <label className="inline-flex items-center gap-2">
                <span className="text-micro font-semibold uppercase tracking-wider text-gray-500">Status</span>
                <select
                  value={STATUS_OPTIONS.includes(staff.status as typeof STATUS_OPTIONS[number]) ? staff.status : 'active'}
                  onChange={(e) => void patchBasic({ status: e.target.value })}
                  disabled={busy === 'basic'}
                  className="h-7 rounded-full bg-gray-100 px-2.5 text-micro font-bold uppercase tracking-wider text-gray-700 outline-none ring-1 ring-gray-200 transition"
                >
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* Card A.5 — Roles */}
      {!isAdmin && (
        <section className={`overflow-hidden rounded-2xl border ${sc.border} bg-white shadow-sm`}>
          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Roles</h2>
              <p className="mt-0.5 text-caption text-gray-500">
                Staff can hold many roles. Effective permissions = UNION of every role&apos;s set,
                then layered with the per-page overrides below.
              </p>
            </div>
            <div className="text-caption text-gray-500">
              {envelope.roles.length} role{envelope.roles.length === 1 ? '' : 's'}
            </div>
          </header>
          <div className="flex flex-wrap items-center gap-1.5 px-5 py-3">
            {envelope.roles.map((r) => (
              <span
                key={r.id}
                className="group inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-semibold ring-1 ring-inset"
                style={{
                  backgroundColor: `${r.color}1A`,  // ~10% alpha
                  color: r.color,
                  borderColor: `${r.color}33`,
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
                {r.label}
                {!r.is_system || envelope.roles.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => void setStaffRoles(envelope.roles.filter((x) => x.id !== r.id).map((x) => x.id))}
                    disabled={busy === `roles:${r.id}`}
                    aria-label={`Remove role ${r.label}`}
                    className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-current opacity-60 transition hover:bg-white/40 hover:opacity-100"
                  >
                    <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                ) : null}
              </span>
            ))}
            {envelope.roles.length === 0 && (
              <span className="text-caption italic text-gray-400">No roles assigned — staff has no role-granted permissions.</span>
            )}
            <AddRolePopover
              roles={envelope.availableRoles.filter((r) => !envelope.roles.some((x) => x.id === r.id))}
              onAdd={(roleId) => void setStaffRoles([...envelope.roles.map((r) => r.id), roleId])}
              disabled={busy?.startsWith('roles:')}
            />
          </div>
          <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-2 text-micro text-gray-600">
            Primary role: <b>{envelope.roles[0]?.label ?? '—'}</b>
            {envelope.roles.length > 1 && ` · ${envelope.roles.length - 1} additional`}
            {' · '}
            <span className="text-gray-500">Edit role permissions in <a href="/admin?section=roles" className="text-blue-600 hover:underline">Roles</a>.</span>
          </div>
        </section>
      )}

      {/* Card B — .access */}
      <section className={`overflow-hidden rounded-2xl border ${sc.border} bg-white shadow-sm`}>
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">.access</h2>
            <p className="mt-0.5 text-caption text-gray-500">
              {isAdmin
                ? 'Admin role grants everything. Remove the admin role to customise.'
                : 'Toggle to grant or revoke individual pages on top of the role.'}
            </p>
          </div>
          {!isAdmin && (added.length > 0 || removed.length > 0) && (
            <button
              type="button"
              onClick={() => void patchPermissions({ add: [], remove: [] })}
              disabled={busy?.startsWith('perm:')}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-micro font-semibold uppercase tracking-wider text-gray-700 hover:bg-gray-50 hover:text-gray-900"
            >
              Reset overrides
            </button>
          )}
        </header>
        <ul className="divide-y divide-gray-100">
          {pagePerms.map((item) => {
            const perm = item.requires as PermissionString;
            const inRole = roleDbPermissions.has(perm);
            const isAdded = added.includes(perm);
            const isRemoved = removed.includes(perm);
            const enabled = isAdmin || (inRole && !isRemoved) || isAdded;
            const source = classifyPermissionSource(inRole, isAdded, isRemoved);

            const onToggle = () => {
              if (isAdmin) return;
              let nextAdd = [...added];
              let nextRemove = [...removed];
              if (enabled) {
                // Turning off
                if (inRole) {
                  if (!nextRemove.includes(perm)) nextRemove.push(perm);
                  nextAdd = nextAdd.filter((p) => p !== perm);
                } else {
                  // It was on via override-add only
                  nextAdd = nextAdd.filter((p) => p !== perm);
                }
              } else {
                // Turning on
                if (inRole) {
                  // It was off via override-remove only
                  nextRemove = nextRemove.filter((p) => p !== perm);
                } else {
                  if (!nextAdd.includes(perm)) nextAdd.push(perm);
                  nextRemove = nextRemove.filter((p) => p !== perm);
                }
              }
              void patchPermissions({ add: nextAdd, remove: nextRemove });
            };

            return (
              <PageAccessSwitch
                key={item.id}
                label={item.label}
                permission={perm}
                enabled={enabled}
                source={source}
                theme={theme}
                disabled={isAdmin}
                busy={busy?.startsWith('perm:')}
                onToggle={onToggle}
              />
            );
          })}
        </ul>
      </section>

      {/* Card C — Credentials */}
      <section className={`overflow-hidden rounded-2xl border ${sc.border} bg-white shadow-sm`}>
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Credentials</h2>
            <p className="mt-0.5 text-caption text-gray-500">PIN, passkeys, and active sessions.</p>
          </div>
        </header>
        <div className="divide-y divide-gray-100">
          {/* PIN */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div>
              <div className="text-sm font-semibold text-gray-900">PIN</div>
              <div className="mt-0.5 text-caption text-gray-500">
                {staff.has_pin ? `Set ${staff.pin_set_at ? fmtRelative(staff.pin_set_at) : ''}` : 'Not set'}
                {staff.pin_locked_until && new Date(staff.pin_locked_until).getTime() > Date.now() && (
                  <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wider text-amber-900">
                    Locked until {new Date(staff.pin_locked_until).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPinDialogOpen(true)}
                disabled={busy != null}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-caption font-semibold uppercase tracking-wider text-gray-700 hover:bg-gray-50 hover:text-gray-900"
              >
                Update PIN
              </button>
              <button
                type="button"
                onClick={resetPin}
                disabled={busy === 'reset-pin'}
                className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-caption font-semibold uppercase tracking-wider text-amber-800 hover:bg-amber-100"
              >
                {busy === 'reset-pin' ? 'Resetting…' : 'Reset PIN'}
              </button>
            </div>
          </div>

          {/* Passkeys */}
          <div className="px-5 py-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">Passkeys</div>
              <div className="text-caption text-gray-500">{passkeys.length}</div>
            </div>
            {passkeys.length === 0 ? (
              <p className="mt-1 text-caption text-gray-400">No passkeys registered.</p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100">
                {passkeys.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-gray-800">{p.device_label || 'Unlabeled device'}</div>
                      <div className="truncate text-micro text-gray-500">
                        added {fmtRelative(p.created_at)}{p.last_used_at && ` · used ${fmtRelative(p.last_used_at)}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void revokePasskey(p.id)}
                      disabled={busy === `pk:${p.id}`}
                      className="rounded-md border border-red-200 px-2 py-0.5 text-micro font-semibold uppercase tracking-wider text-red-700 hover:bg-red-50"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Sessions */}
          <div className="px-5 py-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">Active sessions</div>
              <div className="flex items-center gap-2">
                <div className="text-caption text-gray-500">{sessions.length}</div>
                {sessions.length > 0 && (
                  <button
                    type="button"
                    onClick={revokeAllSessions}
                    disabled={busy === 'ses:all'}
                    className="rounded-md border border-red-200 px-2 py-0.5 text-micro font-semibold uppercase tracking-wider text-red-700 hover:bg-red-50"
                  >
                    Revoke all
                  </button>
                )}
              </div>
            </div>
            {sessions.length === 0 ? (
              <p className="mt-1 text-caption text-gray-400">No active sessions.</p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100">
                {sessions.map((s) => (
                  <li key={s.sid} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-gray-800">
                        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wider text-gray-600 mr-1.5">{s.device_kind}</span>
                        {s.device_label || 'Unlabeled'}
                      </div>
                      <div className="truncate text-micro text-gray-500">
                        {s.ip || 'no-ip'} · seen {fmtRelative(s.last_seen_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void revokeSession(s.sid)}
                      disabled={busy === `ses:${s.sid}`}
                      className="rounded-md border border-red-200 px-2 py-0.5 text-micro font-semibold uppercase tracking-wider text-red-700 hover:bg-red-50"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Card C.5 — Mobile display */}
      <MobileDisplayCard
        sc={sc}
        rolesForResolve={envelope.roles}
        staffOverride={staff.mobile_display_config}
        busy={busy === 'mobile'}
        onSave={(config) => void patchMobileConfig(config)}
        onReset={() => void patchMobileConfig(null)}
      />

      {/* Card D — Audit */}
      <section className={`overflow-hidden rounded-2xl border ${sc.border} bg-white shadow-sm`}>
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Recent audit</h2>
            <p className="mt-0.5 text-caption text-gray-500">Last 20 events for this staff.</p>
          </div>
        </header>
        {audit.length === 0 ? (
          <p className="px-5 py-6 text-center text-caption text-gray-400">No audit entries yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-2 text-caption">
                <span className="font-mono text-gray-700">{a.event}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wider ring-1 ring-inset ${
                  a.result === 'ok' ? 'bg-green-100 text-green-800 ring-green-200'
                  : a.result === 'denied' ? 'bg-amber-100 text-amber-800 ring-amber-200'
                  : 'bg-red-100 text-red-800 ring-red-200'
                }`}>{a.result}</span>
                <span className="text-gray-500">{fmtRelative(a.created_at)}</span>
                {a.ip && <span className="text-gray-400">{a.ip}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Reset PIN — enrollment QR modal */}
      {qrUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setQrUrl(null)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900">Reset PIN for {staff.name}</h2>
            <p className="mt-1 text-xs text-gray-500">
              Have them scan this on their phone to pick a new PIN. Expires {new Date(qrUrl.expiresAt).toLocaleString()}.
            </p>
            <div className="my-5 inline-block rounded-2xl border border-gray-200 bg-white p-4">
              <QRCode value={qrUrl.url} size={220} level="M" />
            </div>
            <p className="break-all text-micro text-gray-400">{qrUrl.url}</p>
            <button type="button" onClick={() => setQrUrl(null)} className="mt-5 rounded-xl bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-black">
              Done
            </button>
          </div>
        </div>
      )}

      {/* Update PIN dialog */}
      <SetPinDialog
        open={pinDialogOpen}
        staffName={staff.name}
        onClose={() => setPinDialogOpen(false)}
        onSubmit={async (pin) => {
          const r = await fetch(`/api/admin/staff/${staffId}/set-pin`, {
            method: 'POST', credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pin }),
          });
          if (!r.ok) {
            const data = await r.json().catch(() => ({}));
            return { ok: false, error: String((data as { error?: string }).error || 'Could not set PIN.') };
          }
          await refresh();
          notifyList();
          return { ok: true };
        }}
      />
    </div>
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
      <button type="button" onClick={() => { onSave(draftName.trim() || name, draftCode.trim()); setEditing(false); }} className="h-9 rounded-md bg-gray-900 px-3 text-sm font-semibold text-white hover:bg-black">
        Save
      </button>
      <button type="button" onClick={() => { setDraftName(name); setDraftCode(code); setEditing(false); }} className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
        Cancel
      </button>
    </div>
  );
}

// ─── Mobile display card ────────────────────────────────────────────────
//
// Lets an admin override the mobile UI for one staff. Two controls today:
// (1) bottom-nav enabled toggle, (2) which tabs render (Home, Picks, Sign
// out — Scan stays centred and is always available when present in the
// tab list). The card always shows the *effective* state (role default +
// override) so the admin sees what the staff will actually experience.
//
// "Reset to role default" clears the override entirely; the resolver then
// falls back to roles.mobile_defaults, which is itself editable from
// /admin?section=roles.

interface MobileCardProps {
  sc: { border: string };
  rolesForResolve: ReadonlyArray<RoleSlim>;
  staffOverride: unknown;
  busy: boolean;
  onSave: (config: unknown) => void;
  onReset: () => void;
}

const TAB_LABELS: Record<MobileNavTabId, string> = {
  home: 'Home',
  scan: 'Scan (centre)',
  picks: 'Picks',
  signout: 'Sign out',
};

function MobileDisplayCard({ sc, rolesForResolve, staffOverride, busy, onSave, onReset }: MobileCardProps) {
  // The override starts out as whatever the DB has. The form mutates a
  // local draft; "Save" PATCHes the override blob.
  const initialOverride = useMemo(
    () => sanitizeMobileDisplayConfig(staffOverride),
    [staffOverride],
  );

  // Resolved (inherited + override) — what the staff actually sees today.
  const resolved: MobileDisplayConfig = useMemo(
    () => resolveMobileDisplayConfig({
      roles: rolesForResolve.map((r) => ({ key: r.key, mobile_defaults: r.mobile_defaults })),
      staffOverride,
    }),
    [rolesForResolve, staffOverride],
  );

  const hasOverride = initialOverride !== null;
  const [draftEnabled, setDraftEnabled] = useState<boolean>(resolved.bottomNav.enabled);
  const [draftTabs, setDraftTabs] = useState<MobileNavTabId[]>([...resolved.bottomNav.tabs]);

  // Resync the draft when the underlying staff/role data changes (e.g. after a save).
  useEffect(() => {
    setDraftEnabled(resolved.bottomNav.enabled);
    setDraftTabs([...resolved.bottomNav.tabs]);
  }, [resolved]);

  const toggleTab = (id: MobileNavTabId) => {
    setDraftTabs((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  };

  const dirty =
    draftEnabled !== resolved.bottomNav.enabled ||
    draftTabs.length !== resolved.bottomNav.tabs.length ||
    draftTabs.some((t, i) => t !== resolved.bottomNav.tabs[i]);

  const save = () => {
    onSave({
      bottomNav: {
        enabled: draftEnabled,
        tabs: draftTabs.length > 0 ? draftTabs : ['scan'],
      },
    });
  };

  // Primary role label for the "inherited" hint.
  const primaryRoleLabel = rolesForResolve[0]?.label ?? '—';

  return (
    <section className={`overflow-hidden rounded-2xl border ${sc.border} bg-white shadow-sm`}>
      <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Mobile display</h2>
          <p className="mt-0.5 text-caption text-gray-500">
            Controls what this staff sees on their phone. Defaults inherit from <b>{primaryRoleLabel}</b>.
            Edit role defaults in <a href="/admin?section=roles" className="text-blue-600 hover:underline">Roles</a>.
          </p>
        </div>
        {hasOverride && (
          <button
            type="button"
            onClick={onReset}
            disabled={busy}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-caption font-semibold uppercase tracking-wider text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title="Clear per-staff override; fall back to role default"
          >
            Reset to role
          </button>
        )}
      </header>

      <div className="space-y-4 px-5 py-4">
        {/* Bottom nav enabled */}
        <label className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">Bottom navigation bar</div>
            <p className="mt-0.5 text-caption text-gray-500">
              When off, the phone is locked to a single page — no tabs to wander into other sections.
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

        {/* Tabs */}
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

        {/* Save row */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
          <div className="text-micro text-gray-500">
            {hasOverride ? 'Per-staff override active.' : 'Inheriting role default.'}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-caption font-semibold uppercase tracking-wider text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving…' : dirty ? 'Save override' : 'Saved'}
          </button>
        </div>
      </div>
    </section>
  );
}
