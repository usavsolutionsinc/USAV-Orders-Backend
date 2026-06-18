import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getNasStorageTarget } from '@/lib/tenancy/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * PROD proof for the Zendesk claim NAS archive.
 *
 * Vercel can't write to the LAN NAS, so this route (server-side) calls the
 * archive agent running on the office machine — through the Cloudflare tunnel
 * (Caddy reverse-proxies /_agent/* → the agent) — which does the real mkdir on
 * the NAS under ".../2 Zendesk 2026/<name>/". A success here proves the live
 * path: prod browser → Vercel → tunnel → agent → NAS write.
 *
 * Env (Production):
 *   NAS_AGENT_URL   = https://nas-photos.michaelgarisek.com/_agent
 *   NAS_AGENT_TOKEN = <shared secret, also on the agent>
 */
export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const base = (process.env.NAS_AGENT_URL || '').replace(/\/+$/, '');
      const token = process.env.NAS_AGENT_TOKEN || '';
      if (!base || !token) {
        return NextResponse.json(
          { success: false, error: 'NAS agent not configured (NAS_AGENT_URL / NAS_AGENT_TOKEN)' },
          { status: 503 },
        );
      }

      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      const name =
        String((body as { name?: unknown }).name || '').trim() || `TEST-${Date.now()}`;
      let claimTarget = { root: '', folder: '' };
      try {
        const org = await getOrganization(ctx.organizationId);
        if (org) claimTarget = getNasStorageTarget(org.settings, 'claims');
      } catch {
        claimTarget = { root: '', folder: '' };
      }

      const res = await fetch(`${base}/test-folder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-agent-token': token },
        body: JSON.stringify({
          name,
          note: 'claim popover prod test button',
          archiveRoot: claimTarget.root,
          archiveFolder: claimTarget.folder,
        }),
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; folder?: string; name?: string; error?: string }
        | null;

      if (!res.ok || !data?.ok) {
        return NextResponse.json(
          { success: false, error: data?.error || `agent returned ${res.status}` },
          { status: 502 },
        );
      }

      return NextResponse.json({ success: true, folder: data.folder, name: data.name });
    } catch (error) {
      return errorResponse(error, 'POST /api/receiving/nas-archive-test');
    }
  },
  { permission: 'receiving.upload_photo' },
);
