import { requirePermission } from '@/lib/auth/page-guard';
import { StudioShell } from '@/components/studio/StudioShell';
import { StudioUpgradePrompt } from '@/components/studio/StudioUpgradePrompt';
import { isStudioGated } from '@/lib/billing/studio-gate';

/**
 * /studio — the Operations Studio (ST1: read-only shell).
 *
 * One full-page canvas where the whole operation is modeled and observed:
 * L0 business map (department groups) ⇄ L1 flow graph (process nodes with
 * numbered lifecycle states), with the Library and Inspector panes alongside.
 * View state (?v=&focus=&z=) lives in the URL so any view is shareable.
 *
 * Read-only by design at this phase — editing (draft → publish) unlocks at
 * ST4 behind studio.manage. See docs/operations-studio/operations-studio-plan.md.
 *
 * Plan-gated by the `studio` entitlement (Part-2 Track 2). The gate is
 * PERMISSIVE BY DEFAULT — isStudioGated returns false (with no DB read) unless
 * STUDIO_ENTITLEMENT_ENFORCED is set, and the dogfood/internal org plus a
 * per-org override flag are always exempt — so with the default flag OFF this
 * page renders the full Studio exactly as before. When enforcement is on and
 * the plan lacks Studio, we show a soft upgrade prompt rather than 404/redirect.
 */
export const metadata = { title: 'Operations Studio' };

export default async function StudioPage() {
  const user = await requirePermission('studio.view');
  if (await isStudioGated(user.organizationId)) {
    return <StudioUpgradePrompt />;
  }
  return <StudioShell />;
}
