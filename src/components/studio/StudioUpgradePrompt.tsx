import Link from 'next/link';
import { Lock, Sparkles } from '@/components/Icons';

/**
 * Shown in place of the Studio canvas when the tenant's plan does not include
 * the Operations Studio capability AND entitlement enforcement is on. It is a
 * soft upsell — never a hard 404/redirect — so the operator understands what
 * Studio is and how to unlock it.
 *
 * Only ever rendered when STUDIO_ENTITLEMENT_ENFORCED is set; under the
 * permissive default this component is unreachable and the full Studio renders
 * exactly as before. Styling follows the house dashed-box empty state with
 * semantic tokens only.
 */
export function StudioUpgradePrompt() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-canvas p-6">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-dashed border-border-soft bg-surface-card px-8 py-10 text-center shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-700">
          <Lock className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-bold text-text-default">Studio isn&apos;t included in your plan</p>
          <p className="text-caption text-text-soft">
            The Operations Studio lets you build, observe, and diagnose your whole operations
            graph. Upgrade your plan to unlock it for your team.
          </p>
        </div>
        <Link
          href="/settings/billing"
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-caption font-bold text-white transition-colors hover:bg-blue-700"
        >
          <Sparkles className="h-3.5 w-3.5" />
          View plans &amp; upgrade
        </Link>
      </div>
    </div>
  );
}
