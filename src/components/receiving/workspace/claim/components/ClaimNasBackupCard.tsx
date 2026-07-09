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
 * Local-storage backup row, shared by the create "Filed" step and link "Linked"
 * step. Three states: idle prompt, backed-up OK, partial/failed.
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
      <section className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Folder className="h-3.5 w-3.5 text-text-faint" />
          <p className="text-micro font-black uppercase tracking-[0.14em] text-text-soft">
            Local backup
          </p>
          <span className="h-1.5 w-1.5 rounded-full bg-gray-300" aria-hidden />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canArchive ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<Archive />}
              loading={c.archiveSubmitting}
              disabled={c.archiveSubmitting || !c.row.receiving_id}
              onClick={c.archiveToNas}
            >
              {c.archiveSubmitting ? 'Saving…' : 'Back up locally'}
            </Button>
          ) : (
            <p className="flex items-center gap-1.5 text-caption font-medium text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Backing up…
            </p>
          )}
          {folder ? (
            <span className="text-caption font-medium text-text-muted">→ /{folder}</span>
          ) : null}
        </div>
      </section>
    );
  }

  // ── Backed up (OK or partial/failed) ────────────────────────────────────
  const dotClass = backupOk ? 'bg-emerald-500' : 'bg-amber-500';

  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {backupOk ? (
          <Folder className="h-3.5 w-3.5 text-text-faint" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        )}
        <p className="text-micro font-black uppercase tracking-[0.14em] text-text-soft">
          {backupOk ? 'Local backup' : 'Backup incomplete'}
        </p>
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
      </div>
      <p className="text-caption font-medium text-text-default">
        {a.copied}/{a.total} {a.total === 1 ? 'photo' : 'photos'}
        {folder ? (
          <>
            {' '}
            → <span className="font-bold">/{folder}</span>
          </>
        ) : null}
        {backupOk ? (
          <span className="text-text-muted">
            {' '}
            · <FileText className="mb-px inline h-3 w-3" /> case-info.txt
          </span>
        ) : null}
      </p>
      {!backupOk ? (
        <p className="text-caption font-medium text-amber-800">
          {a.warning || 'Some photos did not copy.'}
        </p>
      ) : null}

      {canArchive ? (
        backupOk ? (
          <HoverTooltip label="Save the carton photos to local storage again" asChild>
            <Button
              variant="ghost"
              size="sm"
              icon={<Archive />}
              loading={c.archiveSubmitting}
              disabled={c.archiveSubmitting || !c.row.receiving_id}
              onClick={c.archiveToNas}
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
          >
            {c.archiveSubmitting ? 'Saving…' : 'Retry backup'}
          </Button>
        )
      ) : null}
    </section>
  );
}
