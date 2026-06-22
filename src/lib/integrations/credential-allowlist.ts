/**
 * Credential operation allowlist (Wave 5).
 *
 * Strict allowlisting of operations per integration credential. A credential is
 * authorized ONLY for the operations its provider declares here — anything else
 * is denied at the service layer (requireCredentialPermission / withCredentialScope),
 * even if the OAuth token technically has broader scope. This is defense in depth:
 *   - a compromised or over-scoped token can't be driven to do something the app
 *     was never meant to do with it;
 *   - new code can't silently start calling a provider operation the integration
 *     wasn't provisioned for — it must be added here deliberately (and reviewed).
 *
 * Operations are coarse capability strings `"<resource>.<verb>"` (verb ∈ read|write),
 * scoped to the provider by the call site — NOT raw API endpoints. Keep them
 * aligned to what our service code actually performs.
 */

import type { IntegrationProvider } from './credentials';

export type CredentialOperation = `${string}.${'read' | 'write'}`;

/**
 * Allowed operations per provider credential. Empty/missing provider entry ⇒ no
 * operations allowed (deny-by-default) — adding a provider here is a deliberate,
 * reviewable step.
 */
const ALLOWLIST: Partial<Record<IntegrationProvider, ReadonlySet<CredentialOperation>>> = {
  zoho: new Set<CredentialOperation>([
    // Inbound (receiving) sync — Waves 2-4.
    'purchaseorders.read',
    'purchasereceives.read',
    'organizations.read',
    // Outbound fulfillment sync (push shipped orders into Zoho Inventory).
    'salesorders.read',
    'salesorders.write',
    'packages.write',
    'shipments.write',
    'invoices.write',
  ]),
  // ebay / amazon / ecwid / square / ups / fedex / usps / zendesk … declare
  // their operation sets here as their service code is brought under scope.
};

/** Whether `operation` is allowed for `provider`'s credential. Pure + in-memory. */
export function isOperationAllowed(
  provider: IntegrationProvider,
  operation: CredentialOperation,
): boolean {
  return ALLOWLIST[provider]?.has(operation) ?? false;
}

/** The allowed operation set for a provider (empty set when none declared). */
export function allowedOperations(provider: IntegrationProvider): ReadonlySet<CredentialOperation> {
  return ALLOWLIST[provider] ?? new Set<CredentialOperation>();
}
