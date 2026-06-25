import {
  AlertTriangle,
  Archive,
  CheckCircle,
  ExternalLink,
  FileText,
  Folder,
  Loader2,
  RotateCcw,
} from '@/components/Icons';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';

/**
 * Step 4 — Confirmation. Two result cards, side by side in the linear stack:
 * what happened to the Zendesk ticket, and what the NAS agent did with the
 * photos (folder + counts + the case-info.txt notepad). A partial/failed
 * backup surfaces a retry. The footer carries "Continue to seller".
 */
export function ClaimConfirmStep({ c }: { c: ReceivingClaimController }) {
  const { filedTicket, archiveState, template, isDryRun } = c;
  const subject = template.subject.trim();
  const a = archiveState;
  const backupOk = !!a?.ok;
  const folder = a?.folder?.trim() || filedTicket?.number?.replace(/^#/, '') || null;

  return (
    <div className="space-y-3">
      {isDryRun ? (
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-amber-800">
          Dry run — no Zendesk ticket, NAS folder, or DB rows were created. Counts below are simulated.
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

      {/* ── NAS backup result ─────────────────────────────────────────── */}
      <section
        className={`rounded-2xl border p-3.5 ${
          backupOk ? 'border-blue-200 bg-blue-50/70' : 'border-amber-300 bg-amber-50/70'
        }`}
      >
        <div className="flex items-start gap-2.5">
          {backupOk ? (
            <Folder className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          )}
          <div className="min-w-0 flex-1">
            <p
              className={`text-[10px] font-black uppercase tracking-[0.14em] ${
                backupOk ? 'text-blue-800' : 'text-amber-800'
              }`}
            >
              {backupOk ? 'Photos backed up to NAS' : 'NAS backup incomplete'}
            </p>

            {a ? (
              <>
                <p
                  className={`mt-0.5 text-label font-bold ${
                    backupOk ? 'text-blue-900' : 'text-amber-900'
                  }`}
                >
                  {a.copied}/{a.total} {a.total === 1 ? 'photo' : 'photos'}
                  {folder ? (
                    <span className="font-semibold"> → /{folder}</span>
                  ) : null}
                </p>
                {backupOk ? (
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-blue-800/80">
                    <FileText className="h-3 w-3 shrink-0" />
                    case-info.txt written with the ticket details
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] font-medium text-amber-800/90">
                    {a.warning || 'Some photos did not copy. Retry the backup.'}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-blue-800/80">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Waiting on the office agent…
              </p>
            )}

            {/* The re-archive actions hit the live NAS endpoint, so they are
                suppressed during a dry run. */}
            {isDryRun ? null : !backupOk ? (
              <button
                type="button"
                onClick={c.archiveToNas}
                disabled={c.archiveSubmitting || !c.row.receiving_id}
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-micro font-black uppercase tracking-wider text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {c.archiveSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                {c.archiveSubmitting ? 'Retrying…' : 'Retry backup'}
              </button>
            ) : (
              <button
                type="button"
                onClick={c.archiveToNas}
                disabled={c.archiveSubmitting || !c.row.receiving_id}
                title="Re-copy the carton photos to the NAS folder"
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 text-micro font-bold uppercase tracking-wider text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {c.archiveSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Archive className="h-3.5 w-3.5" />
                )}
                {c.archiveSubmitting ? 'Archiving…' : 'Re-archive'}
              </button>
            )}
          </div>
        </div>
      </section>

      <p className="text-[11px] font-semibold leading-5 text-gray-500">
        Continue to draft the seller-facing message — it references this case # for full context.
      </p>
    </div>
  );
}
