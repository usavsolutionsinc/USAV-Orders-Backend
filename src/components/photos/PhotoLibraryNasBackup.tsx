'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';

interface NasBackupStatus {
  agentConfigured: boolean;
  pendingMirror: number;
}

interface NasBackupBatchResult {
  enqueued: number;
  completed: number;
  failed: number;
  remaining: number;
}

export function PhotoLibraryNasBackup() {
  const queryClient = useQueryClient();

  const status = useQuery<NasBackupStatus>({
    queryKey: ['photos-nas-backup-status'],
    queryFn: async () => {
      const res = await fetch('/api/photos/nas-backup', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 15_000,
  });

  const backup = useMutation({
    mutationFn: async (): Promise<NasBackupBatchResult> => {
      let remaining = status.data?.pendingMirror ?? 1;
      let totalCompleted = 0;
      let totalFailed = 0;
      let batches = 0;

      while (remaining > 0 && batches < 40) {
        const res = await fetch('/api/photos/nas-backup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ limit: 25 }),
        });
        const json = (await res.json().catch(() => null)) as NasBackupBatchResult & {
          error?: string;
        };
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        totalCompleted += json.completed ?? 0;
        totalFailed += json.failed ?? 0;
        remaining = json.remaining ?? 0;
        batches++;
        if ((json.enqueued ?? 0) === 0) break;
      }

      return {
        enqueued: totalCompleted + totalFailed,
        completed: totalCompleted,
        failed: totalFailed,
        remaining,
      };
    },
    onSuccess: (result) => {
      if (result.remaining === 0 && result.completed > 0) {
        toast.success(`Backed up ${result.completed} photo${result.completed === 1 ? '' : 's'} to NAS`);
      } else if (result.remaining === 0 && result.completed === 0) {
        toast.success('All GCS photos already have a NAS copy');
      } else if (result.completed > 0) {
        toast.success(
          `Backed up ${result.completed} photo${result.completed === 1 ? '' : 's'} — ${result.remaining} still pending (run again)`,
        );
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} photo${result.failed === 1 ? '' : 's'} failed — check Admin › Receiving Photos`);
      }
      queryClient.invalidateQueries({ queryKey: ['photos-nas-backup-status'] });
      queryClient.invalidateQueries({ queryKey: ['admin-photos-stats'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'NAS backup failed'),
  });

  if (status.isLoading || !status.data?.agentConfigured) {
    return null;
  }

  const pending = status.data.pendingMirror;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">NAS cold backup</p>
        <p className="text-xs text-muted-foreground">
          Copy GCS photos to the office NAS via the tunnel agent
          {pending > 0 ? ` · ${pending} pending` : ' · up to date'}.
        </p>
      </div>
      <button
        type="button"
        disabled={backup.isPending || pending === 0}
        onClick={() => backup.mutate()}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
      >
        {backup.isPending ? 'Backing up…' : pending === 0 ? 'Backed up' : 'Backup to NAS'}
      </button>
    </div>
  );
}
