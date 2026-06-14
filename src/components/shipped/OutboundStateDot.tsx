import { OUTBOUND_STATE_META, type OutboundState } from '@/lib/outbound-state';

/** Tiny colored dot for a package's derived outbound state (table rows). */
export function OutboundStateDot({ state, className = '' }: { state: OutboundState; className?: string }) {
  const meta = OUTBOUND_STATE_META[state];
  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${meta.dot} ${className}`.trim()}
    />
  );
}
