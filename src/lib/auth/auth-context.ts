import type { CurrentUser } from './current-user';

/**
 * Auth context shapes handed to route handlers by `withAuth`. Extracted into a
 * leaf module so lower-level helpers (e.g. `lib/audit-logs`) can reference them
 * as types without importing `withAuth` — which imports `recordAudit` back,
 * forming a cycle. `withAuth` re-exports both for backwards compatibility.
 */
export interface AuthContext {
  user: CurrentUser;
  session: CurrentUser['session'];
  staffId: number;
  /** Active tenant id — every business query should be scoped by this. */
  organizationId: string;
  role: CurrentUser['role'];
  permissions: CurrentUser['permissions'];
  /**
   * Call this when the handler writes its own rich `audit_logs` row (with
   * before/after diffs). The wrapper-level `audit:` floor will skip so we
   * don't double-write. No-op when the wrapper has no `audit:` configured.
   */
  markAuditWritten: () => void;
}

export interface AnonymousAuthContext {
  user: CurrentUser | null;
  session: CurrentUser['session'] | null;
  staffId: number | null;
  /** Null when truly anonymous; otherwise mirrors authenticated context. */
  organizationId: string | null;
  role: CurrentUser['role'] | null;
  permissions: CurrentUser['permissions'];
  markAuditWritten: () => void;
}
