/**
 * Credential scope — the service-layer authorization choke point (Wave 5).
 *
 * Every use of a stored integration credential should go through
 * `withCredentialScope`, which:
 *   1. enforces the operation allowlist (requireCredentialPermission) — deny by
 *      default, even if the OAuth token has broader scope;
 *   2. confirms the org actually has an ACTIVE credential for the provider
 *      (fail fast with a clear error instead of deep in the HTTP layer);
 *   3. records credential usage to the audit ledger (throttled for the common
 *      'allowed' case; denials/errors always recorded) + touches last_used_at;
 *   4. runs the work, and on failure flags the integration in error.
 *
 * This pairs with the ROUTE-layer permission (withAuth({permission})): the route
 * checks the human/staff may invoke the feature; this checks the credential may
 * perform the operation. Both must pass.
 */

import pool from '@/lib/db';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  getIntegrationCredentials,
  markIntegrationError,
  type IntegrationProvider,
} from './credentials';
import { isOperationAllowed, type CredentialOperation } from './credential-allowlist';

/** Operation not permitted for this credential type. Map to HTTP 403. */
export class CredentialPermissionError extends Error {
  readonly provider: IntegrationProvider;
  readonly operation: string;
  readonly code = 'CREDENTIAL_OPERATION_NOT_ALLOWED' as const;
  constructor(provider: IntegrationProvider, operation: string) {
    super(`Credential for "${provider}" is not allowed to perform "${operation}".`);
    this.name = 'CredentialPermissionError';
    this.provider = provider;
    this.operation = operation;
  }
}

/** Org has no active credential for the provider. Map to HTTP 409/424. */
export class CredentialNotConnectedError extends Error {
  readonly provider: IntegrationProvider;
  readonly code = 'CREDENTIAL_NOT_CONNECTED' as const;
  constructor(provider: IntegrationProvider, orgId: OrgId) {
    super(`No active "${provider}" credential for org ${orgId}.`);
    this.name = 'CredentialNotConnectedError';
    this.provider = provider;
  }
}

/**
 * Assert the credential type may perform the operation (pure, in-memory — cheap
 * enough to call per request). Records a denial to the audit ledger as a side
 * effect when it throws. Throwing keeps deny-by-default un-bypassable.
 */
export function requireCredentialPermission(
  provider: IntegrationProvider,
  operation: CredentialOperation,
  ctx?: { orgId?: OrgId; scope?: string | null },
): void {
  if (!isOperationAllowed(provider, operation)) {
    if (ctx?.orgId) {
      void recordCredentialUsage({
        orgId: ctx.orgId,
        provider,
        scope: ctx.scope ?? null,
        operation,
        outcome: 'denied',
        detail: 'operation not on allowlist',
      });
    }
    throw new CredentialPermissionError(provider, operation);
  }
}

export interface CredentialScopeParams {
  orgId: OrgId;
  provider: IntegrationProvider;
  operation: CredentialOperation;
  scope?: string | null;
}

/**
 * Run `fn` with the org's credential under full scope enforcement + audit.
 * `fn` receives the decrypted credential (callers that bind their own client —
 * e.g. Zoho via withZohoOrg — may ignore it).
 */
export async function withCredentialScope<T>(
  params: CredentialScopeParams,
  fn: (credential: unknown) => Promise<T>,
): Promise<T> {
  const { orgId, provider, operation } = params;
  const scope = params.scope ?? null;

  // 1. Allowlist (throws CredentialPermissionError + records denial).
  requireCredentialPermission(provider, operation, { orgId, scope });

  // 2. Require an active credential.
  const credential = await getIntegrationCredentials(orgId, provider, { scope });
  if (!credential) {
    void recordCredentialUsage({ orgId, provider, scope, operation, outcome: 'denied', detail: 'no active credential' });
    throw new CredentialNotConnectedError(provider, orgId);
  }

  // 3. Record usage (throttled) + touch last_used_at (throttled).
  void recordCredentialUsage({ orgId, provider, scope, operation, outcome: 'allowed' });
  void touchIntegrationLastUsed(orgId, provider, scope);

  // 4. Run; flag the integration on failure.
  try {
    return await fn(credential);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void recordCredentialUsage({ orgId, provider, scope, operation, outcome: 'error', detail: message });
    void markIntegrationError(orgId, provider, message, scope).catch(() => {});
    throw err;
  }
}

// ── audit + last_used throttling ────────────────────────────────────────────
// In-memory throttle so a high-frequency sync (per-PO, per-order) doesn't write
// an audit row / UPDATE last_used_at on every call. Only the common 'allowed'
// path is throttled; denials and errors are always written.
const THROTTLE_MS = 5 * 60 * 1000;
const lastWriteAt = new Map<string, number>();

function throttleKey(parts: Array<string | null>): string {
  return parts.map((p) => p ?? '').join('|');
}

export interface CredentialUsageRecord {
  orgId: OrgId;
  provider: IntegrationProvider;
  scope: string | null;
  operation: string;
  outcome: 'allowed' | 'denied' | 'error';
  detail?: string;
}

/**
 * Append a credential-usage row. Best-effort: a missing table (pre-migration)
 * or any insert failure is swallowed so observability never breaks the job.
 * 'allowed' is throttled per (org,provider,scope,operation); denials/errors are
 * always written.
 */
export async function recordCredentialUsage(rec: CredentialUsageRecord): Promise<void> {
  if (rec.outcome === 'allowed') {
    const key = throttleKey([rec.orgId, rec.provider, rec.scope, rec.operation, 'audit']);
    const now = Date.now();
    const prev = lastWriteAt.get(key);
    if (prev && now - prev < THROTTLE_MS) return;
    lastWriteAt.set(key, now);
  }
  try {
    await pool.query(
      `INSERT INTO integration_credential_audit
         (organization_id, provider, scope, operation, outcome, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [rec.orgId, rec.provider, rec.scope, rec.operation, rec.outcome, (rec.detail ?? '').slice(0, 2000) || null],
    );
  } catch {
    /* observability must never break the job (table may not exist yet) */
  }
  if (rec.outcome !== 'allowed') {
    console.warn(`[credential-scope] ${rec.outcome} ${rec.provider}:${rec.operation} org=${rec.orgId}`, rec.detail ?? '');
  }
}

/** Throttled UPDATE of organization_integrations.last_used_at (no-op for env-only USAV). */
async function touchIntegrationLastUsed(orgId: OrgId, provider: IntegrationProvider, scope: string | null): Promise<void> {
  const key = throttleKey([orgId, provider, scope, 'lastused']);
  const now = Date.now();
  const prev = lastWriteAt.get(key);
  if (prev && now - prev < THROTTLE_MS) return;
  lastWriteAt.set(key, now);
  try {
    await pool.query(
      `UPDATE organization_integrations
          SET last_used_at = now()
        WHERE organization_id = $1 AND provider = $2 AND COALESCE(scope, '') = COALESCE($3, '')`,
      [orgId, provider, scope],
    );
  } catch {
    /* best-effort */
  }
}
