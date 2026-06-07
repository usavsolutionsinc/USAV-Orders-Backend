/**
 * Shared types + small formatters for the StaffAccessDetail card set.
 *
 * Extracted from the former 1361-line StaffAccessDetail.tsx so the detail
 * hook, the individual cards, and the pure permission-matrix module can all
 * import one source of truth. No React in here — keep it import-light.
 */

export interface DetailEnvelope {
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
  audit: AuditEntry[];
  roles: RoleSlim[];
  availableRoles: RoleSlim[];
}

export interface RoleSlim {
  id: number;
  key: string;
  label: string;
  color: string;
  position: number;
  permissions: string[];
  is_system: boolean;
  mobile_defaults?: unknown;
}

export interface AuditEntry {
  id: number;
  event: string;
  result: string;
  ip: string | null;
  sid: string | null;
  user_agent: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export const STATUS_OPTIONS = ['active', 'invited', 'suspended', 'disabled'] as const;

// Header goal chip stations. Kept local (not imported from the server-only
// staff-stations-queries module) so no DB code leaks into this client bundle.
export const STATION_OPTIONS = ['TECH', 'PACK', 'UNBOX', 'SALES', 'FBA'] as const;
export type StationKey = (typeof STATION_OPTIONS)[number];
export const STATION_LABELS: Record<StationKey, string> = {
  TECH: 'Tech',
  PACK: 'Packing',
  UNBOX: 'Unboxing',
  SALES: 'Sales',
  FBA: 'FBA',
};

export interface StationAssignment {
  primary: StationKey | null;
  secondary: StationKey[];
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function fmtRelative(when: string | null | undefined): string {
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
