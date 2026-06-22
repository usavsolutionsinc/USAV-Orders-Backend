import { CopyableId } from './CopyableId';

/** Hub header — product title + Zoho chip + copyable canonical SKU. */
export function ProductHubHeader({ sku, title }: { sku: string; title: string | null }) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-4">
      <h1 className="min-w-0 flex-1 truncate text-sm font-black tracking-tight text-gray-900">{title || '—'}</h1>
      <span className="inline-flex shrink-0 items-center rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-eyebrow font-semibold uppercase tracking-wider text-red-700">
        Zoho
      </span>
      <CopyableId value={sku} className="shrink-0 font-mono text-caption font-bold tracking-tight text-gray-500" />
    </header>
  );
}
