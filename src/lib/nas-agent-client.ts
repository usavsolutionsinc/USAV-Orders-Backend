import 'server-only';

import { getOrganization } from '@/lib/tenancy/organizations';
import {
  DEFAULT_NAS_STORAGE_TARGETS,
  getNasStorageTarget,
  type NasStorageTargetKey,
  type OrgSettings,
} from '@/lib/tenancy/settings';
import type { OrgId } from '@/lib/tenancy/constants';

/** Office NAS Media Agent base URL (no trailing slash). */
export function nasAgentUrl(): string {
  return (process.env.NAS_AGENT_URL || '').trim().replace(/\/+$/, '');
}

export function nasAgentToken(): string {
  return process.env.NAS_AGENT_TOKEN || process.env.NAS_RW_TOKEN || '';
}

/** True when upstream requests should carry admin-configured filesystem roots. */
export function usesNasAgentUpstream(base: string): boolean {
  const b = base.replace(/\/+$/, '');
  return /\/_agent(?:\/|$)/.test(b) || /\/file\/(?:receiving|shipping|claims)(?:\/|$)/.test(b);
}

export function nasRootHeader(root: string | undefined | null): Record<string, string> {
  const r = (root || '').trim().replace(/\/+$/, '');
  return r ? { 'x-nas-root': r } : {};
}

export function getNasStorageRoots(settings: OrgSettings): Record<NasStorageTargetKey, string> {
  return {
    receiving: getNasStorageTarget(settings, 'receiving').root,
    shipping: getNasStorageTarget(settings, 'shipping').root,
    claims: getNasStorageTarget(settings, 'claims').root,
  };
}

/**
 * Push workflow roots from Admin → NAS Photos to the office agent so
 * NAS_ROOT_* env vars are bootstrap defaults only, not the live source of truth.
 */
export async function syncAgentRootsFromSettings(
  settings: OrgSettings,
): Promise<{ ok: boolean; error?: string }> {
  const base = nasAgentUrl();
  const token = nasAgentToken();
  if (!base || !token) {
    return { ok: false, error: 'NAS_AGENT_URL and NAS_AGENT_TOKEN are not set on Vercel' };
  }

  const roots = getNasStorageRoots(settings);
  const payload = {
    receiving: roots.receiving || DEFAULT_NAS_STORAGE_TARGETS.receiving.root,
    shipping: roots.shipping || DEFAULT_NAS_STORAGE_TARGETS.shipping.root,
    claims: roots.claims || DEFAULT_NAS_STORAGE_TARGETS.claims.root,
  };

  try {
    const res = await fetch(`${base}/roots`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-agent-token': token,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `agent sync HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'agent sync failed' };
  }
}

/** Headers for /api/nas and /api/nas-target proxy calls to the office agent. */
export async function buildNasAgentProxyHeaders(
  organizationId: OrgId,
  target: NasStorageTargetKey,
  upstreamBase: string,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = nasAgentToken();
  if (token) headers['x-agent-token'] = token;
  if (!usesNasAgentUpstream(upstreamBase)) return headers;
  try {
    const org = await getOrganization(organizationId);
    if (org) {
      Object.assign(headers, nasRootHeader(getNasStorageTarget(org.settings, target).root));
    }
  } catch {
    /* best-effort */
  }
  return headers;
}

/** Read upstream for GET /api/nas — tunnel browse root or agent list/file. */
export function resolveNasReceivingUpstream(activeNasUrl: string): string {
  const envBase = (process.env.NAS_RW_URL || '').trim().replace(/\/+$/, '');
  if (envBase) return envBase;
  const agent = nasAgentUrl();
  if (agent) return `${agent}/file/receiving`;
  return activeNasUrl;
}

/**
 * Write upstream for PUT/DELETE /api/nas.
 * The public tunnel browse server is usually read-only (GET/HEAD only), so
 * writes must go through the office NAS Media Agent when configured.
 */
export function resolveNasReceivingWriteUpstream(activeNasUrl: string): string {
  const agent = nasAgentUrl();
  const token = nasAgentToken();
  if (agent && token) return `${agent}/file/receiving`;
  const envBase = (process.env.NAS_RW_URL || '').trim().replace(/\/+$/, '');
  if (envBase) return envBase;
  return activeNasUrl;
}
