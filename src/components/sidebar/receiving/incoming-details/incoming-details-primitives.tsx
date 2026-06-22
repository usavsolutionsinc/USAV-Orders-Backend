import { Copy as CopyIcon } from '@/components/Icons';
import { copyValue } from './incoming-details-shared';

// ── Tab subcomponents ──────────────────────────────────────────────────────
export function Row({ label, value, copyValue: cv }: { label: string; value: React.ReactNode; copyValue?: string | null }) {
  return (
    <div className="flex items-start gap-3 border-b border-gray-100 py-2 last:border-b-0">
      <span className="w-36 shrink-0 text-eyebrow font-black uppercase tracking-wider text-gray-500">
        {label}
      </span>
      <div className="min-w-0 flex-1 break-words text-caption font-semibold text-gray-900">
        {value}
      </div>
      {cv ? (
        <button
          type="button"
          onClick={() => copyValue(cv, label)}
          className="shrink-0 text-gray-400 hover:text-gray-700"
          title={`Copy ${label}`}
        >
          <CopyIcon className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ msg }: { msg: string }) {
  return (
    <div className="flex h-32 items-center justify-center px-4 text-center text-caption font-medium text-gray-400">
      {msg}
    </div>
  );
}
