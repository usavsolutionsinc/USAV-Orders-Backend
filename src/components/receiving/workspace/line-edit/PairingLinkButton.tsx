'use client';

/**
 * Shared "link" action + "linked" badge for the Package Pairing tabs.
 *
 * Every pairing avenue that links a candidate to the carton — Zoho PO
 * ({@link PoLinkTab}), Email PO ({@link EmailPoLinkTab}), and Zendesk tickets
 * (`MatchCard`) — renders the SAME trailing action and the SAME done-state
 * badge, so the four tabs read identically. Each tab previously hand-rolled its
 * own `<Button>` (drifting variant / label / classes) + its own "Linked"/
 * "Matched" span; this is the single source for both.
 *
 * (The Ecwid tab is intentionally NOT a consumer: its result rows are
 * click-the-whole-row to add, a shared `ResultRow` reused by other surfaces —
 * a different interaction model, not a trailing link button.)
 */
import { Check, Link2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives';

export function PairingLinkButton({
  onClick,
  loading = false,
  disabled = false,
  label = 'Link',
}: {
  onClick: () => void;
  /** This row's link is in flight (spinner). */
  loading?: boolean;
  /** Another row's link is in flight (block double-submits). */
  disabled?: boolean;
  /** Verb override — defaults to "Link"; e.g. "Relink", "Match". */
  label?: string;
}) {
  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      icon={<Link2 />}
      loading={loading}
      disabled={disabled}
      onClick={onClick}
      className="h-7 shrink-0 px-2.5 uppercase tracking-wider"
    >
      {label}
    </Button>
  );
}

/** Done-state pill shown in place of {@link PairingLinkButton} for the linked row. */
export function PairingLinkedBadge({ label = 'Linked' }: { label?: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-eyebrow font-bold uppercase tracking-widest text-emerald-600">
      <Check className="h-3.5 w-3.5" /> {label}
    </span>
  );
}
