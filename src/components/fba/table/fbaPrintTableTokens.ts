/**
 * FBA print queue table — distilled from:
 * - {@link DateGroupHeader} / {@link OrdersQueueTable}: gray section bands, `border-gray-*`, bold 12px titles, uppercase meta
 * - FBA sidebar ({@link FbaWorkspaceScanField}): violet focus/accent (`ring-violet-500`, violet card chrome)
 *
 * Use these literals so Tailwind can purge; compose in components with template strings.
 */
export const fbaPrintTableTokens = {
  /** Outer chrome under toolbar */
  shell: 'bg-gray-50/90',

  toolbar: 'shrink-0 border-b border-gray-200 bg-white px-3 py-2 sm:px-4',
  toolbarTitle: 'text-[10px] font-black uppercase tracking-[0.16em] text-gray-800',
  toolbarRow: 'mt-2 flex flex-wrap items-center gap-3 text-[10px] font-black uppercase tracking-[0.12em] text-gray-600',
  toolbarStat: 'inline-flex items-center gap-1 text-gray-700',
  toolbarIconAccent: 'text-violet-600',
  toolbarIconMuted: 'text-gray-500',
  toolbarIconWarn: 'text-amber-600',

  toolbarSelect:
    'h-8 truncate rounded-lg border border-gray-200 bg-white px-2 text-[10px] font-black uppercase tracking-[0.06em] text-gray-800 shadow-sm',

  refreshButton:
    'flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:border-violet-200 hover:text-violet-700',

  pillButton:
    'inline-flex h-8 items-center justify-center rounded-lg border px-2 text-[10px] font-black uppercase tracking-[0.12em] transition-colors',
  pillIdle: 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50',
  pillActive: 'border-violet-200 bg-violet-50 text-violet-900',

  tableArea: 'min-h-0 flex-1 bg-white',
  emptyCell: 'px-4 py-3 text-center text-[11px] text-gray-400',

  loadingShell: 'flex h-full w-full min-h-0 flex-col items-center justify-center gap-3 bg-gray-50/90 px-6 text-gray-500',
  loadingCard:
    'rounded-2xl border border-gray-200 bg-white px-6 py-5 text-center shadow-sm shadow-gray-200/60',
  loadingSpinner: 'mx-auto h-7 w-7 animate-spin text-violet-600',
  loadingTitle: 'mt-3 block text-sm font-semibold text-gray-800',
  loadingHint: 'mt-1 block text-[11px] text-gray-500',

  errorShell: 'flex h-full w-full min-h-0 flex-col items-center justify-center bg-gray-50/90 px-4 py-16',
  errorCard:
    'max-w-md rounded-3xl border border-red-200 bg-white px-6 py-5 text-center shadow-sm shadow-red-100/70',

  emptyStateShell:
    'flex h-full w-full min-h-0 flex-col items-center justify-center gap-4 bg-gray-50/90 px-4 py-20 text-gray-500',
  emptyStateIconWrap: 'flex h-14 w-14 items-center justify-center rounded-3xl border border-violet-100 bg-violet-50',
  emptyStateIcon: 'h-6 w-6 text-violet-500',
  emptyStateTitle: 'text-sm font-semibold text-gray-800',
  emptyStateBody: 'max-w-[320px] text-center text-xs leading-5 text-gray-500',

  /** Section headers — match {@link DateGroupHeader} density */
  bucketRow: 'border-y border-gray-200 bg-gray-50/90',
  bucketButton:
    'flex w-full items-center gap-2 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 sm:px-4',
  bucketChevron: 'inline-flex text-gray-400',
  bucketLabel: 'text-[11px] font-black uppercase tracking-wide text-gray-800',
  bucketSummary: 'text-[10px] font-semibold text-gray-500',

  /** Shipment group strip */
  shipmentRow: 'border-y border-gray-100 bg-gray-50/80',
  shipmentCell: 'pl-3 pr-3 py-1.5 sm:pl-4',
  shipmentFlex: 'flex flex-wrap items-center gap-2 text-[11px] text-gray-600',
  shipmentRef: 'font-mono font-semibold text-gray-900',
  shipmentMonoMuted: 'font-mono text-gray-500',
  shipmentHint: 'text-gray-400',

  /** Data rows — {@link OrdersQueueTable} title weight + sidebar violet selection */
  itemRowBase:
    'cursor-pointer select-none border-b border-gray-100 transition-colors duration-150 focus-visible:outline-none',
  itemTitle: 'line-clamp-2 text-[12px] font-bold leading-snug text-gray-900',
  itemNote: 'mt-0.5 text-[10px] italic text-gray-500',
  itemMetaRow: 'mt-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500',
  itemMetaIconPrinted: 'h-3.5 w-3.5 text-emerald-600',
  itemMetaIconRemaining: 'h-3.5 w-3.5 text-amber-600',

  modalOverlay: 'fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/40 p-4',
  modalCard:
    'max-w-sm rounded-3xl border border-gray-200 bg-white p-5 shadow-xl shadow-gray-900/10',
  modalTitle: 'text-sm font-black text-gray-900',
  modalBody: 'mt-2 text-xs leading-5 text-gray-600',
  modalCancel:
    'rounded-full border border-gray-200 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-gray-600 transition-colors hover:bg-gray-50',
  modalPrimary:
    'rounded-full bg-violet-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-violet-700',
} as const;
