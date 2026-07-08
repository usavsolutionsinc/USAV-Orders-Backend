import { CheckCircle, ExternalLink, FileText } from '@/components/Icons';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';
import { ClaimNasBackupCard } from './ClaimNasBackupCard';

/**
 * Create step 4 — Confirmation. Ticket filed (success accent) + local backup row.
 */
export function ClaimConfirmStep({ c }: { c: ReceivingClaimController }) {
  const { filedTicket, template, isDryRun } = c;
  const subject = template.subject.trim();

  return (
    <div className="divide-y divide-border-hairline space-y-0 [&>section]:py-3 [&>div]:py-3">
      {isDryRun ? (
        <div className="border-b border-dashed border-amber-300 py-2 text-micro font-black uppercase tracking-[0.14em] text-amber-800">
          Dry run — no Zendesk ticket, local backup, or DB rows were created.
        </div>
      ) : null}

      <section className="space-y-1">
        <div className="flex items-center gap-1.5">
          <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
          <p className="text-micro font-black uppercase tracking-[0.14em] text-emerald-800">
            {isDryRun ? 'Ticket draft (simulated)' : 'Internal ticket filed'}
          </p>
        </div>
        <p className="text-label font-bold text-text-default">{filedTicket?.number ?? '—'}</p>
        {subject ? (
          <p className="flex items-center gap-1.5 truncate text-caption font-medium text-text-muted">
            <FileText className="h-3 w-3 shrink-0" />
            <span className="truncate">{subject}</span>
          </p>
        ) : null}
        {filedTicket?.url ? (
          <a
            href={filedTicket.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-micro font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900"
          >
            Open in Zendesk <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </section>

      <ClaimNasBackupCard c={c} canArchive={!isDryRun} />
    </div>
  );
}
