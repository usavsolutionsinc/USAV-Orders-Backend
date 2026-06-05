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

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import {
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
    default_home_path: string | null;
    default_home_path_mobile: string | null;
    session_policy: 'default' | 'extended' | 'persistent';
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
    user_agent: string | null;
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

// Header goal chip stations. Kept local (not imported from the server-only
// staff-stations-queries module) so no DB code leaks into this client bundle.
const STATION_OPTIONS = ['TECH', 'PACK', 'UNBOX', 'SALES', 'FBA'] as const;
type StationKey = (typeof STATION_OPTIONS)[number];
const STATION_LABELS: Record<StationKey, string> = {
  TECH: 'Tech',
  PACK: 'Packing',
  UNBOX: 'Unboxing',
  SALES: 'Sales',
  FBA: 'FBA',
};

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
  const [stations, setStations] = useState<{ primary: StationKey | null; secondary: StationKey[] }>({
    primary: null,
    secondary: [],
  });

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

  const refreshStations = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/staff/${staffId}/stations`, { credentials: 'include', cache: 'no-store' });
      if (!r.ok) return;
      const data = (await r.json()) as { primary: StationKey | null; secondary: StationKey[] };
      setStations({ primary: data.primary ?? null, secondary: Array.isArray(data.secondary) ? data.secondary : [] });
    } catch {
      /* leave defaults */
    }
  }, [staffId]);

  useEffect(() => { void refreshStations(); }, [refreshStations]);

  const saveStations = useCallback(async (next: { primary: StationKey | null; secondary: StationKey[] }) => {
    setStations(next); // optimistic
    setBusy('stations');
    try {
      const r = await fetch(`/api/admin/staff/${staffId}/stations`, {
        method: 'PUT', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(String((data as { error?: string }).error || 'Station save failed.'));
        await refreshStations();
        return;
      }
      await refreshStations();
    } finally {
      setBusy(null);
    }
  }, [staffId, refreshStations]);

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
  // Primary role = first assigned role by position; legacy staff.role is a
  // mirror kept in sync by /api/admin/staff/[id]/roles and only used as a
  // fallback for staff with no assignments yet.
  const primaryRole = envelope.roles[0];
  const role = (primaryRole?.key ?? staff.role) as StaffRole;
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

  // Effective permission set for this staff: role union, plus added, minus
  // removed. Admin short-circuits to "everything". Used by the Landing Page
  // card to filter the desktop dropdown to pages the staff can actually open.
  const effectivePermissions = new Set<string>();
  if (isAdmin) {
    for (const item of APP_SIDEBAR_NAV) {
      if (item.requires) effectivePermissions.add(item.requires);
    }
  } else {
    for (const p of roleDbPermissions) effectivePermissions.add(p);
    for (const p of added) effectivePermissions.add(p);
    for (const p of removed) effectivePermissions.delete(p);
  }

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
              {/* Primary role — editable dropdown. Selecting a role REPLACES
                  this staffer's entire role set with the chosen one (admin can
                  be switched to any role). staff.role is mirrored server-side. */}
              <label className="inline-flex items-center gap-2">
                <span className="text-micro font-semibold uppercase tracking-wider text-gray-500">Primary</span>
                <select
                  value={primaryRole?.id ?? ''}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (Number.isFinite(id) && id > 0) void setStaffRoles([id]);
                  }}
                  disabled={Boolean(busy?.startsWith('roles:'))}
                  className="h-7 rounded-full bg-gray-100 px-2.5 text-micro font-bold uppercase tracking-wider text-gray-700 outline-none ring-1 ring-gray-200 transition disabled:opacity-60"
                  style={primaryRole ? { color: primaryRole.color } : undefined}
                  title="Replaces this staffer's roles with the selected one."
                >
                  {!primaryRole && <option value="">no roles</option>}
                  {[...envelope.availableRoles, ...envelope.roles]
                    .filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i)
                    .sort((a, b) => a.position - b.position)
                    .map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
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
            {envelope.roles.map((r, idx) => (
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
                {idx === 0 && envelope.roles.length > 1 && (
                  <span
                    className="ml-0.5 rounded-sm px-1 py-px text-eyebrow font-bold uppercase tracking-wider opacity-70"
                    style={{ backgroundColor: `${r.color}26` }}
                    title="Primary role (highest position). Shown in the Identity card."
                  >
                    primary
                  </span>
                )}
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

      {/* Card A.6 — Stations (header goal chip) */}
      <section className={`overflow-hidden rounded-2xl border ${sc.border} bg-white shadow-sm`}>
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Stations</h2>
            <p className="mt-0.5 text-caption text-gray-500">
              The <b>primary</b> station is always shown in the header goal chip and stays locked.
              Add <b>secondary</b> stations to let this staffer switch between goals — the Switch
              control only appears when at least one secondary is set.
            </p>
          </div>
        </header>
        <div className="space-y-3 px-5 py-4">
          {/* Primary station */}
          <label className="flex items-center gap-2.5">
            <span className="w-20 shrink-0 text-micro font-semibold uppercase tracking-wider text-gray-500">Primary</span>
            <select
              value={stations.primary ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                if (!val) { void saveStations({ primary: null, secondary: [] }); return; }
                const p = val as StationKey;
                void saveStations({ primary: p, secondary: stations.secondary.filter((s) => s !== p) });
              }}
              disabled={busy === 'stations'}
              className="h-8 rounded-full bg-gray-100 px-3 text-micro font-bold uppercase tracking-wider text-gray-700 outline-none ring-1 ring-gray-200 transition disabled:opacity-60"
            >
              <option value="">— none (auto from employee code) —</option>
              {STATION_OPTIONS.map((st) => (
                <option key={st} value={st}>{STATION_LABELS[st]}</option>
              ))}
            </select>
          </label>

          {/* Secondary stations */}
          <div className="flex items-start gap-2.5">
            <span className="mt-1.5 w-20 shrink-0 text-micro font-semibold uppercase tracking-wider text-gray-500">Secondary</span>
            <div className="flex flex-wrap gap-1.5">
              {STATION_OPTIONS.map((st) => {
                const isPrimary = stations.primary === st;
                const selected = stations.secondary.includes(st);
                const disabled = busy === 'stations' || !stations.primary || isPrimary;
                return (
                  <button
                    key={st}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (!stations.primary || isPrimary) return;
                      const has = stations.secondary.includes(st);
                      void saveStations({
                        primary: stations.primary,
                        secondary: has
                          ? stations.secondary.filter((s) => s !== st)
                          : [...stations.secondary, st],
                      });
                    }}
                    className={
                      isPrimary
                        ? 'inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-caption font-semibold text-blue-600 ring-1 ring-inset ring-blue-200'
                        : selected
                          ? 'inline-flex items-center gap-1 rounded-full bg-gray-900 px-2.5 py-1 text-caption font-semibold text-white ring-1 ring-inset ring-gray-900 transition disabled:opacity-50'
                          : 'inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-caption font-semibold text-gray-600 ring-1 ring-inset ring-gray-200 transition hover:bg-gray-50 disabled:opacity-50'
                    }
                    title={isPrimary ? 'This is the primary station' : !stations.primary ? 'Pick a primary station first' : selected ? 'Remove secondary station' : 'Add secondary station'}
                  >
                    {STATION_LABELS[st]}
                    {isPrimary && <span className="text-eyebrow font-bold uppercase tracking-wider opacity-70">primary</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-2 text-micro text-gray-600">
          {stations.primary
            ? <>Chip shows <b>{STATION_LABELS[stations.primary]}</b>{stations.secondary.length > 0 ? ` · Switch between ${stations.secondary.length + 1} stations` : ' · no switch (single station)'}</>
            : <>No assignment — chip falls back to the station derived from the employee code.</>}
          {' · '}
          <span className="text-gray-500">Set the daily target per station in <a href="/admin?section=goals" className="text-blue-600 hover:underline">Goals</a>.</span>
        </div>
      </section>

      {/* Card A.25 — Landing page (desktop + mobile) */}
      <LandingPageCard
        sc={sc}
        permissions={effectivePermissions}
        desktopPath={staff.default_home_path}
        mobilePath={staff.default_home_path_mobile}
        primaryRoleKey={role}
        busy={busy === 'basic'}
        onSave={(patch) => void patchBasic(patch)}
      />

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
                    Locked until {new Date(staff.pin_locked_until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
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

          {/* Session policy */}
          <div className="border-t border-gray-100 px-5 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">Session length</div>
                <p className="mt-0.5 text-caption text-gray-500">
                  How long this staff stays signed in before being asked again.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={staff.session_policy}
                  onChange={(e) => void patchBasic({ sessionPolicy: e.target.value })}
                  disabled={busy === 'basic'}
                  className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-400"
                >
                  <option value="default">Default</option>
                  <option value="extended">Extended</option>
                  <option value="persistent">Persistent</option>
                </select>
              </div>
            </div>
            <p className="mt-2 text-micro text-gray-500">
              {staff.session_policy === 'default' && '8h station · 30d personal · 4h phone (with idle timeouts).'}
              {staff.session_policy === 'extended' && 'Personal devices: 7d idle / 90d absolute. Station and phone unchanged.'}
              {staff.session_policy === 'persistent' && 'No idle timeout. Session refreshed on every use — stays signed in indefinitely.'}
            </p>
          </div>

          {/* Sessions */}
          <div className="border-t border-gray-100 px-5 py-3">
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
            <p className="mt-0.5 text-caption text-gray-500">Last 20 events for this staff. Click a row for full detail.</p>
          </div>
        </header>
        {audit.length === 0 ? (
          <p className="px-5 py-6 text-center text-caption text-gray-400">No audit entries yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {audit.map((a) => (
              <AuditRow key={a.id} entry={a} />
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

// ─── Audit row (expandable detail) ──────────────────────────────────────

interface AuditEntry {
  id: number;
  event: string;
  result: string;
  ip: string | null;
  sid: string | null;
  user_agent: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

function summarizeAudit(entry: AuditEntry): { headline: string | null; reason: string | null } {
  const d = entry.detail || {};
  const permission = typeof d.permission === 'string' ? d.permission : null;
  const path = typeof d.path === 'string' ? d.path : null;
  const surface = d.api ? 'API' : d.page ? 'Page' : null;

  if (entry.event === 'permission.denied') {
    const headline = path ? `${surface ?? 'Access'}: ${path}` : surface;
    const reason = permission ? `Missing permission "${permission}"` : 'Permission check failed';
    return { headline: headline ?? null, reason };
  }

  // Generic fallback — surface a path if present, no synthetic reason.
  return { headline: path, reason: null };
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const { headline, reason } = summarizeAudit(entry);
  const detailKeys = Object.keys(entry.detail || {});
  const hasDetail = detailKeys.length > 0 || entry.user_agent || entry.sid;
  const absolute = new Date(entry.created_at).toLocaleString();

  return (
    <li className="text-caption">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`flex w-full flex-wrap items-center gap-3 px-5 py-2 text-left ${hasDetail ? 'hover:bg-gray-50' : 'cursor-default'}`}
      >
        <span className="font-mono text-gray-700">{entry.event}</span>
        <span className={`rounded-full px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wider ring-1 ring-inset ${
          entry.result === 'ok' ? 'bg-green-100 text-green-800 ring-green-200'
          : entry.result === 'denied' ? 'bg-amber-100 text-amber-800 ring-amber-200'
          : 'bg-red-100 text-red-800 ring-red-200'
        }`}>{entry.result}</span>
        <span className="text-gray-500" title={absolute}>{fmtRelative(entry.created_at)}</span>
        {entry.ip && <span className="text-gray-400">{entry.ip}</span>}
        {headline && <span className="ml-auto truncate text-gray-600">{headline}</span>}
        {hasDetail && (
          <span className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>›</span>
        )}
      </button>
      {open && (
        <div className="bg-gray-50 px-5 py-3 text-micro text-gray-700">
          {reason && (
            <div className="mb-2">
              <span className="font-semibold text-gray-800">Reason: </span>
              <span className="text-gray-700">{reason}</span>
            </div>
          )}
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="text-gray-500">When</dt>
            <dd className="font-mono text-gray-800">{absolute}</dd>
            {entry.ip && (<>
              <dt className="text-gray-500">IP</dt>
              <dd className="font-mono text-gray-800">{entry.ip}</dd>
            </>)}
            {entry.sid && (<>
              <dt className="text-gray-500">Session</dt>
              <dd className="font-mono text-gray-800 break-all">{entry.sid}</dd>
            </>)}
            {entry.user_agent && (<>
              <dt className="text-gray-500">User-Agent</dt>
              <dd className="text-gray-800 break-all">{entry.user_agent}</dd>
            </>)}
            {detailKeys.map((k) => {
              const v = (entry.detail as Record<string, unknown>)[k];
              const rendered = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
                ? String(v)
                : JSON.stringify(v);
              return (
                <Fragment key={k}>
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="font-mono text-gray-800 break-all">{rendered}</dd>
                </Fragment>
              );
            })}
          </dl>
        </div>
      )}
    </li>
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
  receive: 'Receive (centre)',
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

// ─── Landing page card ──────────────────────────────────────────────────
//
// Placed after Identity and (for non-admins) the Roles card. Two dropdowns,
// one for desktop, one for mobile, each independent. NULL means "fall back
// to ROLE_HOME[role]" (or MOBILE_ROLE_HOME[role] on the mobile side); the
// resolver lives in /signin/page.tsx and is mirrored in the dropdown
// placeholder text.

// Hard-coded list of mobile destinations. Mirrors the pages that actually
// exist under src/app/m/ — keep in sync if new mobile pages are added.
const MOBILE_LANDING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '/m/home',      label: 'Home (hub)' },
  { value: '/m/scan',      label: 'Scan' },
  { value: '/m/receive',   label: 'Receive (door scan)' },
  { value: '/m/receiving', label: 'Receiving' },
  { value: '/m/pick',      label: 'Pick' },
];

// Desktop default landing for a given primary role — used only as the
// placeholder hint inside the "Use role default" option. Authoritative copy
// lives in /signin/page.tsx (ROLE_HOME).
const DESKTOP_ROLE_DEFAULTS: Record<string, string> = {
  admin: '/dashboard', receiver: '/receiving', receiving: '/receiving',
  packer: '/packer', technician: '/tech', shipper: '/dashboard',
  inventory_manager: '/inventory', sales: '/dashboard',
  viewer: '/dashboard', readonly: '/dashboard',
};
const MOBILE_ROLE_DEFAULTS: Record<string, string> = {
  receiver: '/m/receiving', receiving: '/m/receiving', packer: '/m/pick',
};

interface LandingCardProps {
  sc: { border: string };
  permissions: ReadonlySet<string>;
  desktopPath: string | null;
  mobilePath: string | null;
  primaryRoleKey: string | null;
  busy: boolean;
  onSave: (patch: { defaultHomePath?: string | null; defaultHomePathMobile?: string | null }) => void;
}

function LandingPageCard({
  sc, permissions, desktopPath, mobilePath, primaryRoleKey, busy, onSave,
}: LandingCardProps) {
  // Desktop options = sidebar pages the staff can actually open. Sorted to
  // match the sidebar order so the dropdown feels familiar.
  const desktopOptions = APP_SIDEBAR_NAV
    .filter((item) => !item.requires || permissions.has(item.requires))
    .map((item) => ({ value: item.href, label: item.label }));

  // If the current saved override points somewhere not in the filtered list
  // (e.g. permission was just removed), keep it as a "legacy" option so the
  // admin sees what's stored and can clear it.
  if (desktopPath && !desktopOptions.some((o) => o.value === desktopPath)) {
    desktopOptions.push({ value: desktopPath, label: `${desktopPath} (legacy)` });
  }
  if (mobilePath && !MOBILE_LANDING_OPTIONS.some((o) => o.value === mobilePath)) {
    MOBILE_LANDING_OPTIONS.push({ value: mobilePath, label: `${mobilePath} (legacy)` });
  }

  const desktopDefault = primaryRoleKey ? DESKTOP_ROLE_DEFAULTS[primaryRoleKey.toLowerCase()] ?? '/dashboard' : '/dashboard';
  const mobileDefault = primaryRoleKey ? MOBILE_ROLE_DEFAULTS[primaryRoleKey.toLowerCase()] ?? '/m/home' : '/m/home';

  const onDesktopChange = (v: string) => {
    onSave({ defaultHomePath: v === '' ? null : v });
  };
  const onMobileChange = (v: string) => {
    onSave({ defaultHomePathMobile: v === '' ? null : v });
  };

  return (
    <section className={`overflow-hidden rounded-2xl border ${sc.border} bg-white shadow-sm`}>
      <header className="border-b border-gray-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Landing page</h2>
        <p className="mt-0.5 text-caption text-gray-500">
          Where this staff lands right after signing in. Desktop and mobile are independent —
          leave either on <i>“Use role default”</i> to fall back to the role&apos;s built-in destination.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
        {/* Desktop */}
        <label className="flex flex-col gap-1.5">
          <span className="text-micro font-semibold uppercase tracking-wider text-gray-500">
            Desktop
          </span>
          <select
            value={desktopPath ?? ''}
            onChange={(e) => onDesktopChange(e.target.value)}
            disabled={busy}
            className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-60"
          >
            <option value="">Use role default ({desktopDefault})</option>
            {desktopOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label} — {o.value}</option>
            ))}
          </select>
          <span className="text-micro text-gray-400">
            {desktopPath ? <>Override active: <span className="font-mono text-gray-600">{desktopPath}</span></> : <>Inheriting <span className="font-mono">{desktopDefault}</span></>}
          </span>
        </label>

        {/* Mobile */}
        <label className="flex flex-col gap-1.5">
          <span className="text-micro font-semibold uppercase tracking-wider text-gray-500">
            Mobile
          </span>
          <select
            value={mobilePath ?? ''}
            onChange={(e) => onMobileChange(e.target.value)}
            disabled={busy}
            className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-60"
          >
            <option value="">Use role default ({mobileDefault})</option>
            {MOBILE_LANDING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label} — {o.value}</option>
            ))}
          </select>
          <span className="text-micro text-gray-400">
            {mobilePath ? <>Override active: <span className="font-mono text-gray-600">{mobilePath}</span></> : <>Inheriting <span className="font-mono">{mobileDefault}</span></>}
          </span>
        </label>
      </div>
    </section>
  );
}
