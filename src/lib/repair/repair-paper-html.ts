/** HTML fragments shared with `/api/repair-service/print/[id]`. */

/** Matches `MM/DD/YYYY` width for drop-off / pick-up alignment on blank forms. */
export const REPAIR_PICKUP_DATE_PLACEHOLDER = 'Date: __/__/____';

export const REPAIR_SIGNATURE_ROW_GRID_STYLE =
  'grid-template-columns: 5.75rem minmax(0, 1fr) 11rem';

export function repairSignatureRowHtml(options: {
  label: string;
  dateText: string;
  lineHeightPx: number;
  borderClass?: string;
  innerHtml?: string;
}): string {
  const {
    label,
    dateText,
    lineHeightPx,
    borderClass = 'border-b border-black',
    innerHtml = '',
  } = options;

  return `
          <div class="mb-2 grid items-end gap-x-4" style="${REPAIR_SIGNATURE_ROW_GRID_STYLE}">
            <span class="whitespace-nowrap font-bold">${label}</span>
            <div class="${borderClass} relative overflow-hidden" style="height: ${lineHeightPx}px;">${innerHtml}</div>
            <span class="whitespace-nowrap text-right font-bold tabular-nums">${dateText}</span>
          </div>`;
}

export function repairPaperLetterheadHtml(): string {
  return `
        <div class="text-right mb-8">
          <h2 class="font-bold text-lg">USAV Solutions</h2>
          <p class="text-sm">16161 Gothard St. Suite A</p>
          <p class="text-sm">Huntington Beach, CA 92647, United States</p>
          <p class="text-sm">Tel: (714) 596-6888</p>
        </div>`;
}

export function repairPaperTicketHeadingHtml(
  displayTicket: string,
  escapeHtml: (value: string) => string,
): string {
  return `
        <div class="mb-6 min-w-0">
          <h1 class="text-3xl font-bold mb-2">Repair Service</h1>
          <p class="text-lg font-semibold flex flex-wrap items-baseline gap-x-2">
            ${displayTicket ? `<span class="font-bold">${escapeHtml(displayTicket)}</span>` : ''}
            <span>Repair Ticket Number</span>
          </p>
        </div>`;
}
