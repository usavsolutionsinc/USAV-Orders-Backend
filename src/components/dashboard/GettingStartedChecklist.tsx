'use client';

/**
 * Getting-Started checklist — the read-time activation checklist
 * (onboarding-foundational-plan §4/§7, O2).
 *
 * Renders the plan-filtered step catalog (`src/lib/onboarding/steps.ts`) against
 * the org's live activation stats (GET /api/onboarding/stats). Steps complete
 * because the underlying data exists — never because someone clicked "done" —
 * so the card self-heals and self-dismisses at 100% (renders null).
 *
 * Dismissal: "Skip for now" persists `onboardingDismissed: true` into the
 * staffer's server-backed prefs bag (`staff_preferences` via
 * useStaffPreferences — the same cross-device mechanism the boards use).
 * Skipping hides the card but never deletes the underlying truth.
 *
 * Mounted as a SIBLING of `FirstScanOnboardingCard` in the dashboard sidebars —
 * that card owns the single "scan your first unit" hero moment; this one owns
 * the broader multi-step activation ladder. Gated behind `dashboard.view` (the
 * same permission as the stats endpoint) so the query never fires for a user
 * who can't see the dashboard.
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useStaffPreferences } from '@/hooks/useStaffPreferences';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Check, ChevronRight, ClipboardList, X } from '@/components/Icons';
import {
  completedStepCount,
  stepsForEntitlements,
  type OnboardingStats,
} from '@/lib/onboarding/steps';

const EYEBROW = 'text-eyebrow font-black uppercase tracking-widest text-text-accent';

/**
 * Permission gate. The data-owning inner component mounts only behind
 * `dashboard.view`, so the stats query never fetches for a user without it.
 */
export function GettingStartedChecklist({ variant = 'band' }: { variant?: 'band' | 'sidebar' }) {
  const { isLoaded, has } = useAuth();
  if (!isLoaded || !has('dashboard.view')) return null;
  return <GettingStartedChecklistInner variant={variant} />;
}

function GettingStartedChecklistInner({ variant }: { variant: 'band' | 'sidebar' }) {
  const entitlements = useEntitlements();
  const { prefs, isLoading: prefsLoading, update } = useStaffPreferences();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['onboarding-stats'],
    // Activation counts change rarely inside one session; poll lazily.
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<OnboardingStats> => {
      const res = await fetch('/api/onboarding/stats');
      if (!res.ok) throw new Error(`onboarding-stats ${res.status}`);
      const body = (await res.json()) as { stats?: OnboardingStats };
      if (!body.stats) throw new Error('onboarding-stats: empty payload');
      return body.stats;
    },
  });

  // Quiet card: while loading, on error, or once dismissed, render nothing —
  // the dashboard never shows a spinner or an error box for an optional nudge.
  if (isLoading || isError || !data || prefsLoading) return null;
  if (prefs?.onboardingDismissed) return null;

  const steps = stepsForEntitlements(entitlements);
  const completed = completedStepCount(steps, data);

  // Self-dismisses at 100% — activation reached, no permanent chrome.
  if (steps.length === 0 || completed >= steps.length) return null;

  const pct = Math.round((completed / steps.length) * 100);

  return (
    <section
      className={
        variant === 'sidebar'
          ? 'bg-surface-card'
          : 'shrink-0 border-b border-border-hairline bg-surface-card px-4 py-3'
      }
      aria-label="Getting started checklist"
    >
      <div
        className={`rounded-xl border border-border-hairline bg-surface-card ${
          variant === 'sidebar' ? 'px-3 py-3' : 'px-5 py-4'
        }`}
      >
        {/* Eyebrow header: title left, progress + skip right. */}
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <ClipboardList className="h-3.5 w-3.5 text-text-accent" />
            <span className={EYEBROW}>Getting started</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="text-eyebrow font-black uppercase tracking-widest leading-none text-text-soft tabular-nums">
              {completed}/{steps.length}
            </span>
            <HoverTooltip label="Skip for now" focusable={false}>
              <IconButton
                type="button"
                ariaLabel="Skip getting-started checklist for now"
                onClick={() => update({ onboardingDismissed: true })}
                icon={<X className="h-3.5 w-3.5 text-text-faint" />}
                className="-my-1 flex h-6 w-6 items-center justify-center rounded-md hover:bg-surface-hover"
              />
            </HoverTooltip>
          </span>
        </div>

        {/* Progress rule — % set up. */}
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full bg-accent-bg transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Linear step list — one row per step, dividers not gaps. */}
        <div className="mt-1.5 divide-y divide-border-hairline">
          {steps.map((step) => {
            const done = step.doneWhen(data);
            if (done) {
              return (
                <div key={step.id} className="flex items-center gap-2 py-1.5">
                  <Check className="h-3.5 w-3.5 shrink-0 text-text-success" />
                  <span className="truncate text-caption font-bold text-text-faint">
                    {step.label}
                  </span>
                </div>
              );
            }
            return (
              <Link
                key={step.id}
                href={step.href}
                className="group flex items-center gap-2 py-1.5 hover:bg-surface-hover"
              >
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-inset ring-border-soft"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-caption font-bold text-text-default">
                    {step.label}
                  </span>
                  <span className="block truncate text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
                    {step.description}
                  </span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5" />
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
