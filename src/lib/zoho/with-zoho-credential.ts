/**
 * Zoho credential scope (Wave 5).
 *
 * The one wrapper Zoho service code should use instead of bare `withZohoOrg`:
 * it enforces the operation allowlist + audits credential usage
 * (withCredentialScope), then binds the tenant org so the Zoho client resolves
 * THAT org's credentials (withZohoOrg). Use it at service-function granularity
 * (per sync / per import), passing the coarse operation the work performs.
 */

import { withCredentialScope } from '@/lib/integrations/credential-scope';
import type { CredentialOperation } from '@/lib/integrations/credential-allowlist';
import type { OrgId } from '@/lib/tenancy/constants';
import { withZohoOrg } from './tenant-context';

/** Operations the Zoho integration may perform (subset of the zoho allowlist). */
export type ZohoOperation =
  | 'purchaseorders.read'
  | 'purchasereceives.read'
  | 'organizations.read'
  | 'salesorders.read'
  | 'salesorders.write'
  | 'packages.write'
  | 'shipments.write'
  | 'invoices.write';

export function withZohoCredential<T>(
  orgId: OrgId,
  operation: ZohoOperation,
  fn: () => Promise<T>,
): Promise<T> {
  return withCredentialScope(
    { orgId, provider: 'zoho', operation: operation as CredentialOperation },
    () => withZohoOrg(orgId, fn),
  );
}
