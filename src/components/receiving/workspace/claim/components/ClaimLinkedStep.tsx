import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';
import { ClaimFiledBanner } from './ClaimFiledBanner';
import { ClaimNasBackupCard } from './ClaimNasBackupCard';

/**
 * Link step 2 — Linked. Mirrors the create "Filed" confirmation: the linked
 * ticket banner plus the shared local-backup card (link mode doesn't auto-archive
 * on link, so this is where the operator backs up the carton photos to the
 * ticket folder). The footer carries "Continue to seller".
 */
export function ClaimLinkedStep({ c }: { c: ReceivingClaimController }) {
  return (
    <div className="space-y-3">
      {c.filedTicket ? (
        <ClaimFiledBanner
          filedTicket={c.filedTicket}
          mode={c.mode}
          linkCommitted={c.linkCommitted}
          unlinking={c.unlinking}
          onUnlink={c.handleBannerUnlink}
        />
      ) : null}

      <ClaimNasBackupCard c={c} canArchive />

      <p className="text-[11px] font-semibold leading-5 text-gray-500">
        Continue to draft the seller-facing message — it references this case # for full context.
      </p>
    </div>
  );
}
