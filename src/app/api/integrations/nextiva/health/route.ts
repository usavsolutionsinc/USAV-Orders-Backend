import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { getIntegrationCredentials, type NextivaCredentials } from '@/lib/integrations/credentials';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/nextiva/health — connector health for the settings card.
 * Reports whether this org has Nextiva credentials + a minted webhook identity.
 */
export const GET = withAuth(
  async (_req: NextRequest, ctx) => {
    try {
      const creds = await getIntegrationCredentials<NextivaCredentials>(ctx.organizationId, 'nextiva');
      const connected = Boolean(creds?.apiKey || creds?.refreshToken);
      return NextResponse.json({
        ok: connected,
        connected,
        webhookConfigured: Boolean(creds?.webhookToken && creds?.webhookSigningSecret),
      });
    } catch (err) {
      return errorResponse(err, 'GET /api/integrations/nextiva/health');
    }
  },
  { permission: 'integrations.zendesk' },
);
