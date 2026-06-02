import { NextResponse } from 'next/server';
import { getZendeskSupportOverview } from '@/lib/zendesk';
import { formatPSTTimestamp } from '@/utils/date';

export const dynamic = 'force-dynamic';

/**
 * Support overview — Zendesk only. (eBay messages/returns were removed when the
 * support surface became a native Zendesk console.) Powers the Operations
 * dashboard's Zendesk tile.
 */
export async function GET() {
  try {
    const zendesk = await getZendeskSupportOverview(10);

    const totals = {
      zendeskTickets: zendesk.count,
      attentionItems: zendesk.error ? 1 : 0,
    };

    return NextResponse.json({
      success: true,
      generatedAt: formatPSTTimestamp(),
      totals,
      zendesk,
    });
  } catch (error: any) {
    console.error('Error building support overview:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to load support overview',
      },
      { status: 500 }
    );
  }
}
