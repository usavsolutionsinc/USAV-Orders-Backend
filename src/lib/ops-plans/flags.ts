/**
 * Feature flag for unified ops-plan inbox (plan tasks + all work-order queues).
 * Server-only — read via process.env at runtime.
 */
export function isOpsPlansUnifiedInboxEnabled(): boolean {
  const v = (process.env.OPS_PLANS_UNIFIED_INBOX ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}
