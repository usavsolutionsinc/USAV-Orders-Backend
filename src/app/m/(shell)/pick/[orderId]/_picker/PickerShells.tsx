// ─── Helper shells ───────────────────────────────────────────────────────────

import { Button } from '@/design-system/primitives';

export function LoadingShell({ label }: { label: string }) {
  return (
    <div className="grid min-h-full place-items-center bg-surface-canvas px-6 py-10 text-center">
      <div>
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        <p className="mt-3 text-sm font-semibold text-text-muted">{label}</p>
      </div>
    </div>
  );
}

export function ErrorShell({ error, onBack }: { error: string; onBack: () => void }) {
  return (
    <div className="grid min-h-full place-items-center bg-surface-canvas px-6 py-10 text-center">
      <div>
        <p className="text-base font-bold text-red-700">Could not load picker</p>
        <p className="mt-2 text-sm text-text-muted">{error}</p>
        <Button variant="brand" size="lg" className="mt-5" onClick={onBack}>
          Back to queue
        </Button>
      </div>
    </div>
  );
}

export function EmptyShell({ onBack }: { onBack: () => void }) {
  return (
    <div className="grid min-h-full place-items-center bg-surface-canvas px-6 py-10 text-center">
      <div>
        <p className="text-base font-bold text-text-muted">Nothing to pick</p>
        <p className="mt-2 text-sm text-text-soft">All allocations for this order are already picked or shipped.</p>
        <Button variant="brand" size="lg" className="mt-5" onClick={onBack}>
          Back to queue
        </Button>
      </div>
    </div>
  );
}

export function CompleteCard({ onBack }: { onBack: () => void }) {
  return (
    <div className="grid place-items-center rounded-3xl border border-emerald-200 bg-emerald-50 px-6 py-12 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-600 text-white">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <p className="mt-3 text-base font-bold text-emerald-900">Pick complete</p>
      <p className="mt-1 text-sm text-emerald-800/80">Cart is ready to hand off to the pack station.</p>
      {/* ds-raw-button: solid-emerald success CTA inside the emerald complete card — keep the bespoke emerald tone */}
      <button
        type="button"
        onClick={onBack}
        className="mt-5 rounded-2xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white active:bg-emerald-800"
      >
        Back to queue
      </button>
    </div>
  );
}
