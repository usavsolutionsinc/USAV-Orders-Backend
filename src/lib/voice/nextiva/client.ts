/**
 * Thin Nextiva REST client — the ONE seam where the provider's HTTP surface
 * lives. The exact base URL, auth header, and endpoint paths are confirmed in
 * the Phase 0 spike (docs/nextiva-voice-support-mode-plan.md §9); until then the
 * methods throw `NextivaNotConfiguredError` when no API key is present, which
 * the routes translate into a graceful 501 (the UI shows "connect Nextiva").
 *
 * Everything reads creds from the vault (getIntegrationCredentials) — never env
 * directly, never tokens to the browser.
 */

import {
  getIntegrationCredentials,
  type NextivaCredentials,
} from '@/lib/integrations/credentials';
import type { OrgId } from '@/lib/tenancy/constants';

export class NextivaNotConfiguredError extends Error {
  constructor(orgId: OrgId) {
    super(`Nextiva is not connected for org ${orgId}`);
    this.name = 'NextivaNotConfiguredError';
  }
}

async function requireCreds(orgId: OrgId): Promise<NextivaCredentials> {
  const creds = await getIntegrationCredentials<NextivaCredentials>(orgId, 'nextiva');
  if (!creds || !creds.apiKey) throw new NextivaNotConfiguredError(orgId);
  return creds;
}

/** Base URL for the Nextiva API — pinned by the spike; overridable via env. */
function baseUrl(): string {
  return (process.env.NEXTIVA_API_BASE_URL || 'https://api.nextiva.com').replace(/\/+$/, '');
}

export interface OriginateCallInput {
  /** E.164 / dialable customer number to ring. */
  to: string;
  /** Agent's Nextiva extension to originate from (falls back to creds.defaultExtension). */
  fromExtension?: string;
}

export interface OriginateCallResult {
  ok: boolean;
  externalCallId?: string;
}

/**
 * Originate a click-to-call from the agent's extension to a customer number.
 *
 * TODO(spike §9.4): wire the real call-control endpoint + payload. The shape
 * below is a placeholder; the auth header and path are confirmed in the spike.
 */
export async function originateCall(orgId: OrgId, input: OriginateCallInput): Promise<OriginateCallResult> {
  const creds = await requireCreds(orgId);
  const fromExtension = input.fromExtension || creds.defaultExtension;
  if (!fromExtension) throw new Error('No originating extension (agent extension or defaultExtension required)');

  const res = await fetch(`${baseUrl()}/v1/calls`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${creds.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: fromExtension, to: input.to }),
  });
  if (!res.ok) throw new Error(`Nextiva originate failed (${res.status})`);
  const json = (await res.json().catch(() => ({}))) as { id?: string; callId?: string };
  return { ok: true, externalCallId: json.callId ?? json.id };
}

/**
 * Fetch a voicemail recording's bytes, authenticated server-side. Returned to
 * the browser only via the same-origin /api/voicemails/[id]/recording proxy.
 *
 * TODO(spike §9.3): confirm whether `recordingUrl` is directly fetchable with
 * the API key (as assumed here) or requires a separate media endpoint.
 */
export async function fetchRecording(
  orgId: OrgId,
  recordingUrl: string,
): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string }> {
  const creds = await requireCreds(orgId);
  const res = await fetch(recordingUrl, {
    headers: { authorization: `Bearer ${creds.apiKey}` },
  });
  if (!res.ok) throw new Error(`Nextiva recording fetch failed (${res.status})`);
  return { body: res.body, contentType: res.headers.get('content-type') || 'audio/mpeg' };
}
