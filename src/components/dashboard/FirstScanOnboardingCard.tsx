'use client';

/**
 * First-scan onboarding card — the brand-new-shop activation nudge.
 *
 * Turns "I signed up" into "I scanned my first unit." Signup (Phase F) already
 * seeds the electronics-refurb workflow template + the org/account; this is the
 * one-time prompt that points the owner at the first station (Receiving) so they
 * actually push a unit through the seeded line.
 *
 * Signal — "has this org processed anything yet?": the existing org-scoped
 * `useOperationsRoi` hook (GET /api/operations/roi). `data.hasData === false`
 * means zero captured throughput / labor / stuck units — i.e. truly brand-new.
 * No new endpoint, no new query (react-query dedupes the shared `['ops-roi']`
 * key with the ROI card), no polling (5-min staleTime), no extra permission.
 *
 * Lifecycle — one-time activation, not permanent chrome: shows ONLY while
 * `hasData === false`. The moment any unit is scanned, `hasData` flips true and
 * this returns null forever after; established shops never see it.
 *
 * Coexistence with `ThroughputRoiCard`: both read the same hook. Their render
 * conditions are mutually exclusive by construction —
 *   hasData === false → THIS welcome card shows, the ROI card returns null
 *   hasData === true  → this returns null, the ROI hero shows
 *   loading / error   → this returns null, the ROI card owns those states
 * so the dashboard never stacks two "no data yet" boxes; exactly one
 * getting-started message shows for a new org. (The ROI card's old dashed empty
 * was removed in favor of this richer first-run state.)
 *
 * Gating: the same `operations.view` permission the ROI card + endpoint use. The
 * data-owning inner component is mounted behind the gate so `useOperationsRoi`
 * never fetches for a user who can't see operations.
 */

import { useRouter } from 'next/navigation';
import { UNBOX_SURFACE_ROUTE } from '@/lib/receiving/surface-path';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/design-system/primitives';
import { Sparkles, Barcode, ChevronRight, Share2 } from '@/components/Icons';
import { useOperationsRoi } from '@/features/operations/workspace/useOperationsRoi';

/** The seeded electronics-refurb lifecycle, in flow order — what each scanned unit runs through. */
const SEEDED_STAGES = ['Receive', 'Test', 'Wipe', 'Grade', 'List', 'Ship'] as const;

const EYEBROW = 'text-eyebrow font-black uppercase tracking-widest text-blue-700';
const STAGE_CHIP =
  'rounded bg-surface-card text-text-muted ring-1 ring-inset ring-border-soft px-1.5 py-0.5 text-micro font-black uppercase tracking-widest';

/**
 * Permission gate. Rendering the data-owning inner component conditionally keeps
 * `useOperationsRoi` from mounting at all for a user without `operations.view`.
 */
export function FirstScanOnboardingCard({ variant = 'band' }: { variant?: 'band' | 'sidebar' }) {
  const { isLoaded, has } = useAuth();
  if (!isLoaded || !has('operations.view')) return null;
  return <FirstScanOnboardingCardInner variant={variant} />;
}

function FirstScanOnboardingCardInner({ variant }: { variant: 'band' | 'sidebar' }) {
  const router = useRouter();
  const { data, isLoading, isError } = useOperationsRoi();

  // Only a CONFIRMED brand-new org (zero throughput) sees this. While loading,
  // on error, or once any unit has been processed (`hasData`), render nothing —
  // the ROI card owns the loading state and the established-shop hero.
  if (isLoading || isError || !data || data.hasData) return null;

  return (
    <section
      className={
        variant === 'sidebar'
          ? 'bg-surface-card'
          : 'shrink-0 border-b border-border-hairline bg-surface-card px-4 py-3'
      }
      aria-label="Get started — scan your first unit"
    >
      <div
        className={`rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white ${
          variant === 'sidebar' ? 'px-3 py-3' : 'px-5 py-4'
        }`}
      >
        {/* Eyebrow — welcoming, not an error tone. */}
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-blue-600" />
          <span className={EYEBROW}>Get started</span>
        </span>

        {/* Headline + one-line explainer of the seeded flow. */}
        <h2 className="mt-2 text-lg font-black leading-tight text-text-default">
          Let&apos;s process your first unit
        </h2>
        <p className="mt-1 text-caption font-medium text-text-muted">
          Your refurb workflow is ready. Every unit you scan flows down this line:
        </p>

        {/* The seeded lifecycle as stage chips (the visual receive → … → ship chain). */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
          {SEEDED_STAGES.map((stage, i) => (
            <span key={stage} className="inline-flex items-center gap-1.5">
              <span className={STAGE_CHIP}>{stage}</span>
              {i < SEEDED_STAGES.length - 1 ? (
                <ChevronRight className="h-3 w-3 text-text-faint" />
              ) : null}
            </span>
          ))}
        </div>

        {/* CTAs — primary to the first station (Unbox); secondary to the graph. */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Button
            variant="primary"
            icon={<Barcode />}
            iconRight={<ChevronRight />}
            onClick={() => router.push(UNBOX_SURFACE_ROUTE)}
          >
            Scan your first unit
          </Button>
          <Button
            variant="ghost"
            icon={<Share2 />}
            onClick={() => router.push('/studio')}
          >
            View your workflow
          </Button>
        </div>
      </div>
    </section>
  );
}
