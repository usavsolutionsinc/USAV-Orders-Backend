import {
  AlertTriangle,
  Archive,
  FileText,
  Folder,
  Loader2,
  RotateCcw,
} from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
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
            <p className="text-micro font-black uppercase tracking-[0.14em] text-blue-800">
              Back up photos to local storage
            </p>
            <p className="mt-0.5 text-caption font-medium leading-5 text-blue-800/80">
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
              <Button
                variant="secondary"
                size="sm"
                icon={<Archive />}
                loading={c.archiveSubmitting}
                disabled={c.archiveSubmitting || !c.row.receiving_id}
                onClick={c.archiveToNas}
                className="mt-2 border-blue-200 bg-white text-blue-700 hover:bg-blue-100"
              >
                {c.archiveSubmitting ? 'Saving…' : 'Back up locally'}
              </Button>
            ) : (
              <p className="mt-1 flex items-center gap-1.5 text-caption font-medium text-blue-800/80">
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
            className={`text-micro font-black uppercase tracking-[0.14em] ${
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
            <p className="mt-1 flex items-center gap-1.5 text-caption font-medium text-blue-800/80">
              <FileText className="h-3 w-3 shrink-0" />
              case-info.txt written with the ticket details
            </p>
          ) : (
            <p className="mt-1 text-caption font-medium text-amber-800/90">
              {a.warning || 'Some photos did not copy. Retry the backup.'}
            </p>
          )}

          {canArchive ? (
            backupOk ? (
              <HoverTooltip label="Save the carton photos to local storage again" asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Archive />}
                  loading={c.archiveSubmitting}
                  disabled={c.archiveSubmitting || !c.row.receiving_id}
                  onClick={c.archiveToNas}
                  className="mt-2 border-blue-200 bg-white text-blue-700 hover:bg-blue-100"
                >
                  {c.archiveSubmitting ? 'Saving…' : 'Back up again'}
                </Button>
              </HoverTooltip>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                icon={<RotateCcw />}
                loading={c.archiveSubmitting}
                disabled={c.archiveSubmitting || !c.row.receiving_id}
                onClick={c.archiveToNas}
                className="mt-2 border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
              >
                {c.archiveSubmitting ? 'Saving…' : 'Retry backup'}
              </Button>
            )
          ) : null}
        </div>
      </div>
    </section>
  );
}
