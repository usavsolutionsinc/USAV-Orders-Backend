/**
 * Feature flag for unified ops-plan inbox (plan tasks + all work-order queues).
 *
 * Per-org via resolveForOrg (audit F34) — DB row `organization_feature_flags
 * (flag='ops_plans_unified_inbox')` overrides env `OPS_PLANS_UNIFIED_INBOX`.
 * Re-exported from the feature-flags SoT so ops-plans callers keep a local
 * import path.
 */
export { isOpsPlansUnifiedInbox } from '@/lib/feature-flags';
