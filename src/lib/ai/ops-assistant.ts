import { extractParams } from '@/lib/ai/intent-router';
import { getPackedOrdersForAi, type ShippedOrder } from '@/lib/neon/orders-queries';
import { resolveAiTimeframe } from '@/lib/ai/date-range';
import type {
  AiBreakdownRow,
  AiChatMode,
  AiSampleRecord,
  AiStructuredAnswer,
  AiTimeframe,
} from '@/lib/ai/types';

type ShippingDimension = 'packer' | 'tester';
type LocalQueryKind = 'summary' | 'missing_attribution';

export interface LocalAiResolution {
  mode: AiChatMode;
  reply: string;
  analysis: AiStructuredAnswer;
}

function buildDashboardHref(timeframe: AiTimeframe): string {
  const params = new URLSearchParams();
  params.set('shipped', '');
  if (typeof timeframe.weekOffset === 'number' && timeframe.weekOffset > 0) {
    params.set('shippedWeekOffset', String(timeframe.weekOffset));
  }
  return `/dashboard?${params.toString()}`;
}

function buildStaffHref(dimension: ShippingDimension, staffId: number | null): string | undefined {
  if (!staffId || !Number.isFinite(staffId)) return undefined;
  return dimension === 'packer' ? `/packer?staffId=${staffId}` : `/tech?staffId=${staffId}`;
}

export function pickLocalOpsDimension(message: string): ShippingDimension {
  const text = message.toLowerCase();
  if (/\btester(s)?\b|\btested\b|\btech(s)?\b|\btechnician(s)?\b/.test(text)) return 'tester';
  return 'packer';
}

function isShippingSummaryQuestion(message: string): boolean {
  const text = message.trim().toLowerCase();
  const mentionsShipping = /\bshipped\b|\bpacked\b|\bshipping\b/.test(text);
  const mentionsOrders = /\border(s)?\b/.test(text);
  const mentionsAggregation =
    /\bhow many\b|\bcount\b|\btotal\b|\bnumber of\b|\bwho\b|\btop\b|\bmost\b|\bbreakdown\b|\bby who\b/.test(text);

  return mentionsShipping && (mentionsOrders || mentionsAggregation) && mentionsAggregation;
}

function isMissingAttributionQuestion(message: string): boolean {
  const text = message.trim().toLowerCase();
  return /\bshipped\b|\bpacked\b/.test(text) && /\bmissing\b/.test(text) && /\btester\b|\bpacker\b|\btech\b/.test(text);
}

export function detectLocalOpsQueryKind(message: string): LocalQueryKind | null {
  if (isMissingAttributionQuestion(message)) return 'missing_attribution';
  if (isShippingSummaryQuestion(message)) return 'summary';
  return null;
}

function shouldHandleLocally(message: string): boolean {
  const kind = detectLocalOpsQueryKind(message);
  if (!kind) return false;

  const params = extractParams(message, []);
  if (params.orderId || params.trackingNumber) return false;
  return true;
}

function formatStaffName(name: string | null | undefined, id: number | null | undefined, fallback: string): string {
  const trimmed = String(name || '').trim();
  if (trimmed) return trimmed;
  if (id && Number.isFinite(id)) return `Staff #${id}`;
  return fallback;
}

function summarizeTop(rows: AiBreakdownRow[]): string {
  if (!rows.length) return 'No operator breakdown was available.';
  const [first, second] = rows;
  if (!second) return `${first.label} recorded ${first.value}.`;
  return `${first.label} led with ${first.value}, followed by ${second.label} at ${second.value}.`;
}

function buildBreakdown(records: ShippedOrder[], dimension: ShippingDimension): AiBreakdownRow[] {
  const map = new Map<string, AiBreakdownRow>();

  for (const record of records) {
    const staffId = dimension === 'packer' ? record.packed_by ?? record.packer_id : record.tested_by ?? record.tester_id;
    const staffName = dimension === 'packer'
      ? formatStaffName(record.packed_by_name, staffId, 'Unassigned packer')
      : formatStaffName(record.tested_by_name || record.tester_name, staffId, 'Unassigned tester');
    const key = `${staffId ?? 'none'}:${staffName}`;
    const existing = map.get(key);
    if (existing) {
      existing.value += 1;
      continue;
    }
    map.set(key, {
      id: key,
      label: staffName,
      value: 1,
      href: buildStaffHref(dimension, staffId ?? null),
    });
  }

  return Array.from(map.values()).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).slice(0, 8);
}

function buildSampleRecords(records: ShippedOrder[]): AiSampleRecord[] {
  return records.slice(0, 5).map((record) => ({
    id: String(record.id),
    primary: `${record.order_id || `Order ${record.id}`} · ${record.product_title || 'Unknown product'}`,
    secondary: [
      record.packed_at ? `Packed ${record.packed_at}` : null,
      record.packed_by_name ? `Packer ${record.packed_by_name}` : null,
      record.tested_by_name ? `Tester ${record.tested_by_name}` : null,
    ].filter(Boolean).join(' | '),
    href: `/dashboard?shipped=&search=${encodeURIComponent(String(record.order_id || record.id))}`,
  }));
}

function buildReply(args: {
  kind: LocalQueryKind;
  total: number;
  timeframe: AiTimeframe;
  dimension: ShippingDimension;
  breakdown: AiBreakdownRow[];
  explicitRange: boolean;
}): string {
  const { kind, total, timeframe, dimension, breakdown, explicitRange } = args;
  const subject = dimension === 'packer' ? 'packed' : 'tested';
  const assumption = explicitRange ? '' : ' I treated this as the current PST week.';

  if (kind === 'missing_attribution') {
    if (total === 0) {
      return `No shipped orders were missing a ${dimension} for ${timeframe.exactLabel}.${assumption}`;
    }
    return `${total} shipped orders were missing a ${dimension} for ${timeframe.exactLabel}.${assumption}`;
  }

  if (total === 0) {
    return `No orders were packed or shipped for ${timeframe.exactLabel}.${assumption}`;
  }

  const leader = summarizeTop(breakdown);
  return `${total} orders were packed/shipped for ${timeframe.exactLabel}. Breakdown by ${subject}: ${leader}${assumption}`;
}

function buildAnalysis(args: {
  kind: LocalQueryKind;
  total: number;
  records: ShippedOrder[];
  timeframe: AiTimeframe;
  dimension: ShippingDimension;
  breakdown: AiBreakdownRow[];
  explicitRange: boolean;
}): AiStructuredAnswer {
  const { kind, total, records, timeframe, dimension, breakdown, explicitRange } = args;
  const missingDimensionCount = records.filter((record) =>
    dimension === 'packer'
      ? record.packed_by == null && record.packer_id == null
      : record.tested_by == null && record.tester_id == null
  ).length;

  const topRow = breakdown[0];
  const sources = [
    {
      id: 'shipped-query',
      label: 'Shipped orders query',
      detail: 'Uses the same shipped-order route filters as the dashboard.',
    },
    {
      id: 'tracking',
      label: 'shipping_tracking_numbers',
      detail: 'Carrier-linked shipped state.',
    },
    {
      id: 'packing',
      label: 'packer_logs',
      detail: 'Packing timestamps and packer attribution.',
    },
    {
      id: 'assignments',
      label: 'work_assignments',
      detail: 'Tester / packer assignment fallback.',
    },
  ];

  return {
    kind: 'shipping_summary',
    title: kind === 'missing_attribution'
      ? `Orders Missing ${dimension === 'packer' ? 'Packer' : 'Tester'}`
      : dimension === 'packer'
        ? 'Packed/Shipped Orders By Packer'
        : 'Packed/Shipped Orders By Tester',
    summary: kind === 'missing_attribution'
      ? total === 0
        ? `No orders were missing a ${dimension} for ${timeframe.exactLabel}.`
        : `${total} orders were missing a ${dimension} for ${timeframe.exactLabel}.`
      : total === 0
        ? `No orders were packed or shipped for ${timeframe.exactLabel}.`
        : `${total} orders were packed/shipped for ${timeframe.exactLabel}.`,
    confidence: kind === 'missing_attribution'
      ? (explicitRange ? 'high' : 'medium')
      : missingDimensionCount > 0 || !explicitRange ? 'medium' : 'high',
    modeLabel: 'Local Ops Query',
    timeframe,
    metrics: [
      {
        label: kind === 'missing_attribution' ? 'Rows missing attribution' : 'Total packed/shipped',
        value: String(total),
        detail: `Counted from ${timeframe.exactLabel}`,
      },
      {
        label: kind === 'missing_attribution'
          ? 'Attribution field'
          : dimension === 'packer'
            ? 'Packers listed'
            : 'Testers listed',
        value: kind === 'missing_attribution'
          ? dimension
          : String(breakdown.length),
        detail: kind === 'missing_attribution'
          ? 'Rows where the shipped order has no operator on that field'
          : missingDimensionCount > 0 ? `${missingDimensionCount} rows missing operator attribution` : 'All rows attributed',
      },
      {
        label: kind === 'missing_attribution' ? 'Recent sample rows' : 'Top operator',
        value: kind === 'missing_attribution' ? String(Math.min(total, 5)) : topRow?.label || 'None',
        detail: kind === 'missing_attribution'
          ? 'Open sample rows below for details'
          : topRow ? `${topRow.value} shipped orders` : 'No shipped rows in range',
      },
    ],
    breakdownTitle: kind === 'missing_attribution'
      ? undefined
      : dimension === 'packer'
        ? 'Packer breakdown'
        : 'Tester breakdown',
    breakdown: kind === 'missing_attribution' ? undefined : breakdown,
    sampleTitle: 'Recent shipped rows in range',
    sampleRecords: buildSampleRecords(records),
    sources,
    followUps: kind === 'missing_attribution'
      ? [
          'How many orders were shipped last week and by who?',
          'Show this week shipped orders by tester',
          'Open the shipped table for last week',
        ]
      : dimension === 'packer'
      ? [
          'Show this week shipped orders by tester',
          'Which shipped orders last week are missing a tester?',
          'Open the shipped table for last week',
        ]
      : [
          'Show this week shipped orders by packer',
          'Which shipped orders last week are missing a tester?',
          'Open the shipped table for last week',
        ],
    actions: [
      {
        label: 'Open shipped table',
        href: buildDashboardHref(timeframe),
      },
    ],
  };
}

export async function resolveLocalAiAnswer(message: string): Promise<LocalAiResolution | null> {
  if (!shouldHandleLocally(message)) return null;

  const queryKind = detectLocalOpsQueryKind(message) || 'summary';
  const timeframe = resolveAiTimeframe(message);
  const dimension = pickLocalOpsDimension(message);
  const allRecords = await getPackedOrdersForAi({
    weekStart: timeframe.start,
    weekEnd: timeframe.end,
    limit: 5000,
  });
  const records = queryKind === 'missing_attribution'
    ? allRecords.filter((record) =>
        dimension === 'packer'
          ? record.packed_by == null && record.packer_id == null
          : record.tested_by == null && record.tester_id == null
      )
    : allRecords;
  const breakdown = queryKind === 'missing_attribution' ? [] : buildBreakdown(records, dimension);
  const reply = buildReply({
    kind: queryKind,
    total: records.length,
    timeframe,
    dimension,
    breakdown,
    explicitRange: timeframe.explicit,
  });
  const analysis = buildAnalysis({
    kind: queryKind,
    total: records.length,
    records,
    timeframe,
    dimension,
    breakdown,
    explicitRange: timeframe.explicit,
  });

  return {
    mode: 'local_ops',
    reply,
    analysis,
  };
}

export function formatAnalysisForPrompt(analysis: AiStructuredAnswer): string {
  const lines = [
    `Mode: ${analysis.modeLabel}`,
    `Title: ${analysis.title}`,
    `Summary: ${analysis.summary}`,
  ];

  if (analysis.timeframe) {
    lines.push(`Timeframe: ${analysis.timeframe.exactLabel}`);
  }

  for (const metric of analysis.metrics || []) {
    lines.push(`Metric - ${metric.label}: ${metric.value}${metric.detail ? ` (${metric.detail})` : ''}`);
  }

  if (analysis.breakdownTitle && analysis.breakdown?.length) {
    lines.push(`${analysis.breakdownTitle}:`);
    for (const row of analysis.breakdown) {
      lines.push(`  ${row.label}: ${row.value}${row.detail ? ` (${row.detail})` : ''}`);
    }
  }

  return lines.join('\n');
}
