'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import { Loader2 } from '@/components/Icons';

interface ChecklistStep {
  step_id: number;
  step_label: string;
  step_type: string;
  sort_order: number;
  passed: boolean | null;
  verified_by: number | null;
  verified_by_name: string | null;
  verified_at: string | null;
  notes: string | null;
}

interface Props {
  /** serial_units.id of the unit on the active slot. */
  serialUnitId: number;
}

/**
 * Per-unit testing checklist. Loads the unit's SKU checklist
 * (qc_check_templates) merged with this unit's recorded results
 * (tech_verifications) and lets the tester mark each step done — recording who
 * completed it. Record-and-track only: it does not gate the Pass+Print verdict.
 *
 * Plain fetch + optimistic state on purpose (no React Query) so it never
 * refetches on window focus and wipes a just-marked step.
 */
export function TestingChecklistCard({ serialUnitId }: Props) {
  const [steps, setSteps] = useState<ChecklistStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingStep, setSavingStep] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/serial-units/${serialUnitId}/checklist`, {
          cache: 'no-store',
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        setSteps(res.ok && data?.ok ? (data.steps as ChecklistStep[]) : []);
      } catch {
        if (!cancelled) setSteps([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serialUnitId]);

  const toggleStep = useCallback(
    async (step: ChecklistStep) => {
      const nextPassed = step.passed !== true;
      setSavingStep(step.step_id);
      // Optimistic — flip locally first so the check feels instant.
      setSteps((prev) =>
        prev.map((s) =>
          s.step_id === step.step_id ? { ...s, passed: nextPassed } : s,
        ),
      );
      try {
        const res = await fetch(`/api/serial-units/${serialUnitId}/checklist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stepId: step.step_id, passed: nextPassed }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || `Save failed (${res.status})`);
        }
        // Reconcile with the server's recorded verifier + timestamp.
        setSteps((prev) =>
          prev.map((s) =>
            s.step_id === step.step_id
              ? {
                  ...s,
                  passed: data.verification?.passed ?? nextPassed,
                  verified_by: data.verification?.verified_by ?? s.verified_by,
                  verified_at: data.verification?.verified_at ?? s.verified_at,
                }
              : s,
          ),
        );
      } catch (err) {
        // Roll back the optimistic flip.
        setSteps((prev) =>
          prev.map((s) =>
            s.step_id === step.step_id ? { ...s, passed: step.passed } : s,
          ),
        );
        toast.error(err instanceof Error ? err.message : 'Could not save step');
      } finally {
        setSavingStep(null);
      }
    },
    [serialUnitId],
  );

  // Nothing to show until we know there's a checklist for this SKU.
  if (!loading && steps.length === 0) return null;

  const done = steps.filter((s) => s.passed === true).length;

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
          Testing checklist
        </h3>
        {steps.length > 0 ? (
          <span
            className={`rounded-md px-2 py-0.5 text-micro font-bold uppercase tracking-wider ${
              done === steps.length
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {done}/{steps.length} done
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-caption text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading checklist…
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {steps.map((step) => {
            const checked = step.passed === true;
            const isSaving = savingStep === step.step_id;
            return (
              <li key={step.step_id}>
                <button
                  type="button"
                  onClick={() => void toggleStep(step)}
                  disabled={isSaving}
                  aria-pressed={checked}
                  className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                    checked
                      ? 'border-emerald-200 bg-emerald-50/60'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-black ${
                      checked
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-gray-300 bg-white text-transparent'
                    }`}
                    aria-hidden
                  >
                    {isSaving ? (
                      <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                    ) : (
                      '✓'
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-caption font-semibold leading-snug text-gray-900">
                      {step.step_label}
                    </span>
                    {checked && step.verified_by_name ? (
                      <span className="mt-0.5 block text-micro font-medium uppercase tracking-wide text-emerald-700">
                        {step.verified_by_name}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
