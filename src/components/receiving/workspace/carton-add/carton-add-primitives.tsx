import { Loader2, Package, Plus } from '@/components/Icons';

// ─── Hint banner (e.g. off-PO notice) ────────────────────────────────────────

export function HintBanner({ text }: { text: string }) {
  return (
    <div className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-micro font-semibold text-amber-800">
      {text}
    </div>
  );
}

// ─── Disabled tab note ───────────────────────────────────────────────────────

export function DisabledNote({ reason }: { reason: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <Package className="h-6 w-6 text-gray-300" />
      <p className="max-w-xs text-label text-gray-500">{reason}</p>
    </div>
  );
}

// ─── Shared result row ───────────────────────────────────────────────────────

export function ResultRow({
  title,
  subtitle,
  imageUrl,
  busy,
  disabled,
  onClick,
}: {
  title: string;
  subtitle: string;
  imageUrl: string | null;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-lg border border-gray-200 px-2.5 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-gray-200" />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-300">
          <Package className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-label font-semibold text-gray-900">{title}</p>
        {subtitle ? <p className="truncate text-micro text-gray-500">{subtitle}</p> : null}
      </div>
      {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-400" /> : <Plus className="h-3.5 w-3.5 shrink-0 text-gray-300" />}
    </button>
  );
}
