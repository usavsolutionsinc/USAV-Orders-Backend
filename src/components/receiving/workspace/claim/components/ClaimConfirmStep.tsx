import { CheckCircle, ExternalLink, FileText } from '@/components/Icons';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';
import { ClaimNasBackupCard } from './ClaimNasBackupCard';

/**
 * Create step 4 — Confirmation. Two result cards in the linear stack: what
 * happened to the Zendesk ticket, and what was saved to local storage
 * (the shared {@link ClaimNasBackupCard}). The footer carries "Continue to
 * seller". During a dry run the result is simulated and re-archive is hidden.
 */
export function ClaimConfirmStep({ c }: { c: ReceivingClaimController }) {
  const { filedTicket, template, isDryRun } = c;
  const subject = template.subject.trim();

  return (
    <div className="space-y-3">
      {isDryRun ? (
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-amber-800">
          Dry run — no Zendesk ticket, local backup, or DB rows were created. Counts below are simulated.
        </div>
      ) : null}

      {/* ── Ticket result ─────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3.5">
        <div className="flex items-start gap-2.5">
          <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-800">
              {isDryRun ? 'Ticket draft (simulated)' : 'Internal ticket filed'}
            </p>
            <p className="mt-0.5 text-label font-bold text-emerald-900">
              {filedTicket?.number ?? '—'}
            </p>
            {subject ? (
              <p className="mt-1 flex items-center gap-1.5 truncate text-[11px] font-medium text-emerald-800/80">
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">{subject}</span>
              </p>
            ) : null}
            {filedTicket?.url ? (
              <a
                href={filedTicket.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-micro font-bold uppercase tracking-wider text-emerald-700 hover:text-emerald-900"
              >
                Open in Zendesk <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Local backup result (re-archive suppressed during a dry run) ─── */}
      <ClaimNasBackupCard c={c} canArchive={!isDryRun} />

      <p className="text-[11px] font-semibold leading-5 text-gray-500">
        Continue to draft the seller-facing message — it references this case # for full context.
      </p>
    </div>
  );
}
