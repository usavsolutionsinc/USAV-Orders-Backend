// Single source of truth for system sync-run status tones.
//
// Flat chip (the only surface — admin SystemSyncActivityTab). Mirrors the
// lib/<domain>-status.ts pattern. Classes preserved verbatim; hues follow the
// color story (DESIGN_SYSTEM.md): success, failed=danger, running=info.
// src/lib is in Tailwind's content globs.

export type SyncRunStatus = 'success' | 'failed' | 'running';

const TONES: Record<SyncRunStatus, string> = {
  success: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-rose-50 text-rose-700',
  running: 'bg-blue-50 text-blue-700',
};

const FALLBACK = 'bg-gray-100 text-gray-600';

/** Flat chip classes for a sync-run status; safe for unknown values. */
export function syncRunStatusChipClass(status: string): string {
  return TONES[status as SyncRunStatus] ?? FALLBACK;
}
