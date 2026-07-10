import {
  packerKpiSummaryToCsvRows,
  totalBoxesPacked,
  type PackingKpiPeriodSummary,
  type PackingKpiSummary,
} from '@/lib/packing/packer-kpi-queries';
import { DEFAULT_TIER_MINUTES } from '@/lib/packing/pack-tier-classifier';

function parsePstDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatReportDate(day: string): string {
  const date = parsePstDay(day);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** e.g. Wed, Jul 8 */
export function formatWeekdayShort(day: string): string {
  const date = parsePstDay(day);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatPeriodRangeLabel(period: PackingKpiPeriodSummary): string {
  if (period.daily.length === 0) return 'No pack days in range';
  const first = formatWeekdayShort(period.start_day);
  const last = formatWeekdayShort(period.end_day);
  const n = period.filled_day_count;
  return `${n} pack day${n === 1 ? '' : 's'} · ${first} through ${last}`;
}

function padCell(value: string, width: number): string {
  const text = String(value);
  if (text.length >= width) return text.slice(0, width);
  return text.padEnd(width, ' ');
}

function buildAsciiTable(summary: PackingKpiSummary, options?: { showPercentOfDay?: boolean }): string[] {
  const showPercentOfDay = options?.showPercentOfDay ?? true;
  const rows = packerKpiSummaryToCsvRows(summary);
  const cols = [
    { key: 'packer', label: 'Packer', width: 14 },
    { key: 'boxes', label: 'Boxes', width: 7 },
    { key: 'small', label: 'Small', width: 7 },
    { key: 'medium', label: 'Medium', width: 8 },
    { key: 'large', label: 'Large', width: 7 },
    { key: 'weightedMin', label: 'Pack min', width: 10 },
    ...(showPercentOfDay ? [{ key: 'percentOfDay' as const, label: '% shift', width: 9 }] : []),
  ];

  const header = cols.map((c) => padCell(c.label, c.width)).join('  ');
  const divider = cols.map((c) => '─'.repeat(c.width)).join('──');
  const body = rows.map((row) =>
    cols.map((c) => padCell(String(row[c.key]), c.width)).join('  '),
  );
  const totals = summary.totals;
  const totalRowCells = [
    padCell('Team total', cols[0].width),
    padCell(String(totals.total_boxes_packed), cols[1].width),
    padCell(String(totals.small_count), cols[2].width),
    padCell(String(totals.medium_count), cols[3].width),
    padCell(String(totals.large_count), cols[4].width),
    padCell(String(totals.weighted_minutes), cols[5].width),
    ...(showPercentOfDay ? [padCell('', cols[6]?.width ?? 9)] : []),
  ];

  return [header, divider, ...body, divider, totalRowCells.join('  ')];
}

function buildDailySummaryAsciiTable(period: PackingKpiPeriodSummary): string[] {
  const cols = [
    { key: 'day', label: 'Day', width: 14 },
    { key: 'boxes', label: 'Boxes', width: 7 },
    { key: 'small', label: 'Small', width: 7 },
    { key: 'medium', label: 'Medium', width: 8 },
    { key: 'large', label: 'Large', width: 7 },
    { key: 'weightedMin', label: 'Pack min', width: 10 },
  ] as const;

  const header = cols.map((c) => padCell(c.label, c.width)).join('  ');
  const divider = cols.map((c) => '─'.repeat(c.width)).join('──');
  const body = period.daily.map((summary) => {
    const row = {
      day: formatWeekdayShort(summary.day),
      boxes: summary.totals.total_boxes_packed,
      small: summary.totals.small_count,
      medium: summary.totals.medium_count,
      large: summary.totals.large_count,
      weightedMin: summary.totals.weighted_minutes,
    };
    return cols.map((c) => padCell(String(row[c.key]), c.width)).join('  ');
  });
  const totals = period.totals;
  const totalRow = [
    padCell('Total', cols[0].width),
    padCell(String(totals.total_boxes_packed), cols[1].width),
    padCell(String(totals.small_count), cols[2].width),
    padCell(String(totals.medium_count), cols[3].width),
    padCell(String(totals.large_count), cols[4].width),
    padCell(String(totals.weighted_minutes), cols[5].width),
  ].join('  ');

  return [header, divider, ...body, divider, totalRow];
}

function buildPeriodPackerAsciiTable(period: PackingKpiPeriodSummary): string[] {
  const pseudoSummary: PackingKpiSummary = {
    day: period.end_day,
    capacity: period.capacity,
    totals: period.totals,
    by_packer: period.by_packer,
    fba: {
      pending_units: 0,
      pending_weighted_minutes: 0,
      avg_minutes_per_unit: null,
      fillable_units: 0,
    },
  };
  return buildAsciiTable(pseudoSummary, { showPercentOfDay: false });
}

function reportNotesLines(
  summary: Pick<PackingKpiSummary, 'capacity' | 'totals'>,
  context: 'day' | 'period',
  filledDays?: number,
): string[] {
  const { SMALL, MEDIUM, LARGE } = DEFAULT_TIER_MINUTES;
  const workday = summary.capacity.workday_minutes;
  const hours = workday / 60;

  return [
    'Notes',
    '',
    'Total boxes packed',
    'Each completed pack scan counts as one box shipped.',
    '',
    'Pack minutes (weighted)',
    `Estimated pack time added up for the day. Defaults: Small ${SMALL} min · Medium ${MEDIUM} min (~12–15) · Large ${LARGE} min (~40–50). SKU profiles override when set.`,
    '',
    'Small · Medium · Large',
    'Small = pack-and-label parts (PCB, cables, adapters, accessories).',
    'Medium = semi-complete systems (Wave, SoundDock, consoles, EQs, small speakers).',
    'Large = full home theater stacks (Lifestyle, CineMate, Acoustimass).',
    '',
    '% shift (single-day only)',
    `Share of an ${hours}-hour pack shift (${workday} min) used on packing. Breaks and non-pack tasks are not included.`,
    '',
    context === 'period' && filledDays
      ? `Period covers ${filledDays} days with pack activity only — days with zero boxes are omitted.`
      : `Team: ${summary.capacity.packer_headcount} packer(s) · ${summary.totals.weighted_minutes} pack minutes total.`,
  ];
}

/** Plain-text report for TextEdit / any editor. */
export function packerKpiSummaryToTextDocument(summary: PackingKpiSummary): string {
  const table = buildAsciiTable(summary).join('\n');

  return [
    'Packing Performance',
    formatReportDate(summary.day),
    '',
    `Total boxes packed: ${summary.totals.total_boxes_packed}`,
    '',
    'By packer',
    table,
    '',
    '─'.repeat(68),
    '',
    ...reportNotesLines(summary, 'day'),
  ].join('\n');
}

export function packerKpiPeriodToTextDocument(period: PackingKpiPeriodSummary): string {
  const dailyTable = buildDailySummaryAsciiTable(period).join('\n');
  const packerTable = buildPeriodPackerAsciiTable(period).join('\n');

  return [
    'Packing Performance — Recent Pack Days',
    formatPeriodRangeLabel(period),
    '',
    `Total boxes packed: ${period.totals.total_boxes_packed}`,
    `Total pack minutes: ${period.totals.weighted_minutes}`,
    '',
    'Daily breakdown (days with activity only)',
    dailyTable,
    '',
    'By packer (all days combined)',
    packerTable,
    '',
    '─'.repeat(68),
    '',
    ...reportNotesLines(
      { capacity: period.capacity, totals: period.totals },
      'period',
      period.filled_day_count,
    ),
  ].join('\n');
}

function rtfEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\n/g, '\\par\n');
}

function buildRtfTable(
  headerCells: string[],
  bodyRows: string[][],
  totalRow: string[],
  colWidths: number[],
): string {
  function rtfRow(cells: string[], bold = false): string {
    const prefix = bold ? '\\b ' : '';
    const suffix = bold ? '\\b0 ' : '';
    const cellMarkup = cells.map((cell) => `${prefix}${rtfEscape(cell)}${suffix}\\cell`).join('\n');
    const widthMarkup = colWidths.map((w) => `\\cellx${w}`).join('');
    return `\\trowd\\trgaph108\\trleft-108\n${widthMarkup}\n${cellMarkup}\n\\row\n`;
  }

  return [rtfRow(headerCells, true), ...bodyRows.map((cells) => rtfRow(cells)), rtfRow(totalRow, true)].join('');
}

export function packerKpiSummaryToRtf(summary: PackingKpiSummary): string {
  const rows = packerKpiSummaryToCsvRows(summary);
  const totals = summary.totals;
  const colWidths = [2400, 1100, 1100, 1300, 1100, 1800, 1400];

  const tableRtf = buildRtfTable(
    ['Packer', 'Boxes', 'Small', 'Medium', 'Large', 'Pack min', '% shift'],
    rows.map((r) => [
      r.packer,
      String(r.boxes),
      String(r.small),
      String(r.medium),
      String(r.large),
      String(r.weightedMin),
      r.percentOfDay,
    ]),
    [
      'Team total',
      String(totals.total_boxes_packed),
      String(totals.small_count),
      String(totals.medium_count),
      String(totals.large_count),
      String(totals.weighted_minutes),
      '',
    ],
    colWidths,
  );

  const notes = reportNotesLines(summary, 'day');

  return [
    '{\\rtf1\\ansi\\deff0',
    '{\\fonttbl{\\f0\\fswiss Helvetica;}}',
    '\\f0\\fs22',
    `\\b ${rtfEscape('Packing Performance')}\\b0\\par`,
    `${rtfEscape(formatReportDate(summary.day))}\\par`,
    `\\b ${rtfEscape(`Total boxes packed: ${summary.totals.total_boxes_packed}`)}\\b0\\par`,
    '\\par',
    `\\b ${rtfEscape('By packer')}\\b0\\par`,
    tableRtf,
    '\\par',
    ...notes.flatMap((line) => {
      if (!line) return ['\\par'];
      if (['Notes', 'Total boxes packed', 'Pack minutes (weighted)', 'Small · Medium · Large', '% shift (single-day only)'].includes(line)) {
        return [`\\b ${rtfEscape(line)}\\b0\\par`];
      }
      return [`${rtfEscape(line)}\\par`];
    }),
    '}',
  ].join('\n');
}

export function packerKpiPeriodToRtf(period: PackingKpiPeriodSummary): string {
  const dailyRows = period.daily.map((summary) => [
    formatWeekdayShort(summary.day),
    String(summary.totals.total_boxes_packed),
    String(summary.totals.small_count),
    String(summary.totals.medium_count),
    String(summary.totals.large_count),
    String(summary.totals.weighted_minutes),
  ]);
  const colWidths = [2600, 1100, 1100, 1300, 1100, 1800];
  const dailyTable = buildRtfTable(
    ['Day', 'Boxes', 'Small', 'Medium', 'Large', 'Pack min'],
    dailyRows,
    [
      'Total',
      String(period.totals.total_boxes_packed),
      String(period.totals.small_count),
      String(period.totals.medium_count),
      String(period.totals.large_count),
      String(period.totals.weighted_minutes),
    ],
    colWidths,
  );

  const packerRows = period.by_packer.map((row) => [
    row.staff_name?.trim() || `Staff #${row.staff_id}`,
    String(totalBoxesPacked(row)),
    String(row.small_count),
    String(row.medium_count),
    String(row.large_count),
    String(row.weighted_minutes),
  ]);
  const packerTable = buildRtfTable(
    ['Packer', 'Boxes', 'Small', 'Medium', 'Large', 'Pack min'],
    packerRows,
    [
      'Total',
      String(period.totals.total_boxes_packed),
      String(period.totals.small_count),
      String(period.totals.medium_count),
      String(period.totals.large_count),
      String(period.totals.weighted_minutes),
    ],
    colWidths,
  );

  const notes = reportNotesLines(
    { capacity: period.capacity, totals: period.totals },
    'period',
    period.filled_day_count,
  );

  return [
    '{\\rtf1\\ansi\\deff0',
    '{\\fonttbl{\\f0\\fswiss Helvetica;}}',
    '\\f0\\fs22',
    `\\b ${rtfEscape('Packing Performance — Recent Pack Days')}\\b0\\par`,
    `${rtfEscape(formatPeriodRangeLabel(period))}\\par`,
    `\\b ${rtfEscape(`Total boxes packed: ${period.totals.total_boxes_packed}`)}\\b0\\par`,
    `${rtfEscape(`Total pack minutes: ${period.totals.weighted_minutes}`)}\\par`,
    '\\par',
    `\\b ${rtfEscape('Daily breakdown')}\\b0\\par`,
    dailyTable,
    '\\par',
    `\\b ${rtfEscape('By packer (all days combined)')}\\b0\\par`,
    packerTable,
    '\\par',
    ...notes.flatMap((line) => {
      if (!line) return ['\\par'];
      if (['Notes', 'Total boxes packed', 'Pack minutes (weighted)', 'Small · Medium · Large'].includes(line)) {
        return [`\\b ${rtfEscape(line)}\\b0\\par`];
      }
      if (line.startsWith('% shift')) return [];
      return [`${rtfEscape(line)}\\par`];
    }),
    '}',
  ].join('\n');
}

export type PackingReportDocumentFormat = 'txt' | 'rtf' | 'csv';

export function packerKpiSummaryToDocument(
  summary: PackingKpiSummary,
  format: PackingReportDocumentFormat,
): string {
  if (format === 'rtf') return packerKpiSummaryToRtf(summary);
  if (format === 'txt') return packerKpiSummaryToTextDocument(summary);
  throw new Error(`Use packerKpiSummaryToCsv for format=${format}`);
}

export function packerKpiPeriodToDocument(
  period: PackingKpiPeriodSummary,
  format: PackingReportDocumentFormat,
): string {
  if (format === 'rtf') return packerKpiPeriodToRtf(period);
  if (format === 'txt') return packerKpiPeriodToTextDocument(period);
  throw new Error(`Period CSV not supported for format=${format}`);
}

export function inferDocumentFormatFromPath(filePath: string): PackingReportDocumentFormat | 'csv' {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'rtf') return 'rtf';
  if (ext === 'txt' || ext === 'text') return 'txt';
  return 'csv';
}
