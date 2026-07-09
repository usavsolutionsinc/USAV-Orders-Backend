/**
 * Gate for the lookup-po "TEST*" tracking demo shortcut. Synthetic cartons must
 * not be created in production tenant data — only the QA sandbox org (or when
 * explicitly enabled via env).
 */

import { resolveQaOrgId } from '@/lib/tenancy/qa-org';

export function isTestTrackingShortcutAllowed(orgId: string): boolean {
  if (process.env.ALLOW_TEST_TRACKING === 'true') return true;
  return orgId === resolveQaOrgId();
}
