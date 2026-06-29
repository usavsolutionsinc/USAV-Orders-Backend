import { Check, Loader2 } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import type { TriageFieldState } from '@/components/po-triage/types';
import { CONFIDENCE_DOT } from './unfound-details-helpers';

// ─── Shared sub-components ───────────────────────────────────────────────────

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-eyebrow font-black uppercase tracking-widest text-gray-400">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-micro font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </dt>
      <dd className="text-label text-gray-800 text-right">{value}</dd>
    </div>
  );
}

export function FieldRow({
  label,
  value,
  field,
  onToggle,
}: {
  label: string;
  value: string | null;
  field: TriageFieldState | undefined;
  onToggle: () => void;
}) {
  const confidence = field?.confidence ?? 'low';
  const confirmed = Boolean(field?.confirmed_at);
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1.5 hover:bg-gray-50">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={confirmed}
        className={`ds-raw-button mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          confirmed
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-gray-300 bg-white'
        }`}
      >
        {confirmed ? <Check className="h-3 w-3" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-micro font-bold uppercase tracking-wider text-gray-500">
            {label}
          </span>
          {value != null && (
            <HoverTooltip label={`Confidence: ${confidence}`} asChild>
              <span
                className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_DOT[confidence]}`}
                aria-hidden
              />
            </HoverTooltip>
          )}
        </div>
        <p className="truncate text-label text-gray-800">{value ?? '—'}</p>
      </div>
    </label>
  );
}

export function LoadingBlock() {
  return (
    <div className="flex h-40 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-label text-amber-800">
      {message}
    </div>
  );
}
