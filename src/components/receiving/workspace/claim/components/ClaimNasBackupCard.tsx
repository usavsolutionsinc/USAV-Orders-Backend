import {
  AlertTriangle,
  Archive,
  FileText,
  Folder,
  Loader2,
  RotateCcw,
} from '@/components/Icons';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';

/**
 * The local-storage backup result/action card, shared by the create "Filed"
 * step and the link "Linked" step. Three states:
 *   - no backup yet → idle prompt + "Back up locally" (when `canArchive`)
 *   - backed up OK  → blue card: counts + folder + case-info.txt note
 *   - partial/failed → amber card: warning + "Retry backup"
 *
 * `canArchive` gates the live action button (suppressed during a dry run, where
 * the result is simulated).
 */
export function ClaimNasBackupCard({
  c,
  canArchive,
}: {
  c: ReceivingClaimController;
  canArchive: boolean;
}) {
  const { archiveState: a, filedTicket } = c;
  const folder = a?.folder?.trim() || filedTicket?.number?.replace(/^#/, '') || null;
  const backupOk = !!a?.ok;

  // ── Idle: nothing backed up yet (link flow before backing up) ─────────────
  if (!a) {
    return (
      <section className="rounded-2xl border border-blue-200 bg-blue-50/70 p-3.5">
        <div className="flex items-start gap-2.5">
          <Folder className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-800">
              Back up photos to local storage
            </p>
            <p className="mt-0.5 text-[11px] font-medium leading-5 text-blue-800/80">
              Save this carton&apos;s photos to local storage in a folder
              {folder ? (
                <>
                  {' '}named <span className="font-bold">/{folder}</span>
                </>
              ) : (
                ' named after the case #'
              )}{' '}
              with a <span className="font-bold">case-info.txt</span> notepad.
            </p>
            {canArchive ? (
              <button
                type="button"
                onClick={c.archiveToNas}
                disabled={c.archiveSubmitting || !c.row.receiving_id}
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 text-micro font-black uppercase tracking-wider text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {c.archiveSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Archive className="h-3.5 w-3.5" />
                )}
                {c.archiveSubmitting ? 'Saving…' : 'Back up locally'}
              </button>
            ) : (
              <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-blue-800/80">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Backing up…
              </p>
            )}
          </div>
        </div>
      </section>
    );
  }

  // ── Backed up (OK or partial/failed) ──────────────────────────────────────
  return (
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
            {backupOk ? 'Photos backed up to local storage' : 'Local backup incomplete'}
          </p>
          <p
            className={`mt-0.5 text-label font-bold ${
              backupOk ? 'text-blue-900' : 'text-amber-900'
            }`}
          >
            {a.copied}/{a.total} {a.total === 1 ? 'photo' : 'photos'}
            {folder ? <span className="font-semibold"> → /{folder}</span> : null}
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

          {canArchive ? (
            <button
              type="button"
              onClick={c.archiveToNas}
              disabled={c.archiveSubmitting || !c.row.receiving_id}
              title={backupOk ? 'Save the carton photos to local storage again' : undefined}
              className={`mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-3 text-micro font-black uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                backupOk
                  ? 'border-blue-200 text-blue-700 hover:bg-blue-100'
                  : 'border-amber-300 text-amber-800 hover:bg-amber-100'
              }`}
            >
              {c.archiveSubmitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : backupOk ? (
                <Archive className="h-3.5 w-3.5" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              {c.archiveSubmitting ? 'Saving…' : backupOk ? 'Back up again' : 'Retry backup'}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
