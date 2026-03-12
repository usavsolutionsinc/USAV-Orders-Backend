import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { EbayClient } from '@/lib/ebay/client';
import { getZendeskSupportOverview } from '@/lib/zendesk';
import { formatPSTTimestamp } from '@/utils/date';

export const dynamic = 'force-dynamic';

interface EbayChannelSummary {
  count: number;
  items: any[];
  error: string | null;
  healthy: boolean;
}

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT account_name
       FROM ebay_accounts
       WHERE COALESCE(is_active, true) = true
       ORDER BY account_name`
    );

    const accounts = await Promise.all(
      result.rows.map(async (row) => {
        const accountName = String(row.account_name || '').trim();
        const client = new EbayClient(accountName);

        const [messagesResult, returnsResult] = await Promise.allSettled([
          client.fetchUnreadMessages(6),
          client.fetchOpenReturns(6),
        ]);

        const unreadMessages: EbayChannelSummary =
          messagesResult.status === 'fulfilled'
            ? {
                count: messagesResult.value.length,
                items: messagesResult.value,
                error: null,
                healthy: true,
              }
            : {
                count: 0,
                items: [],
                error: messagesResult.reason?.message || 'Unable to load unread messages',
                healthy: false,
              };

        const returnRequests: EbayChannelSummary =
          returnsResult.status === 'fulfilled'
            ? {
                count: returnsResult.value.length,
                items: returnsResult.value,
                error: null,
                healthy: true,
              }
            : {
                count: 0,
                items: [],
                error: returnsResult.reason?.message || 'Unable to load return requests',
                healthy: false,
              };

        return {
          accountName,
          unreadMessages,
          returnRequests,
        };
      })
    );

    const zendesk = await getZendeskSupportOverview(10);

    const totals = {
      unreadMessages: accounts.reduce((sum, account) => sum + account.unreadMessages.count, 0),
      returnRequests: accounts.reduce((sum, account) => sum + account.returnRequests.count, 0),
      zendeskTickets: zendesk.count,
      attentionItems:
        accounts.reduce(
          (sum, account) =>
            sum +
            (account.unreadMessages.error ? 1 : 0) +
            (account.returnRequests.error ? 1 : 0),
          0
        ) +
        (zendesk.error ? 1 : 0),
    };

    return NextResponse.json({
      success: true,
      generatedAt: formatPSTTimestamp(),
      totals,
      ebayAccounts: accounts,
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
