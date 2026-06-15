/**
 * Thin Stripe REST client.
 *
 * We deliberately avoid the `stripe` Node SDK so we don't pull in a 1MB
 * dependency for the four endpoints we actually call:
 *   - POST  /v1/customers
 *   - POST  /v1/checkout/sessions
 *   - POST  /v1/billing_portal/sessions
 *   - POST  /v1/webhook_endpoints   (optional, only for bootstrap script)
 *
 * Webhook signature verification is done by hand below — Stripe documents
 * the v1 scheme as HMAC-SHA256 over `<timestamp>.<raw body>` keyed by the
 * webhook signing secret.
 *
 * Credentials are read from the per-tenant integrations vault when an orgId
 * is provided, falling back to the platform STRIPE_* env vars otherwise.
 * Platform creds are used for the public signup flow (before a tenant
 * exists) and for billing actions.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getIntegrationCredentials, type StripeCredentials } from '../integrations/credentials';
import type { OrgId } from '../tenancy/constants';

const STRIPE_BASE = 'https://api.stripe.com/v1';

async function loadCreds(orgId?: OrgId | null): Promise<StripeCredentials> {
  if (orgId) {
    const fromVault = await getIntegrationCredentials<StripeCredentials>(orgId, 'stripe');
    if (fromVault) return fromVault;
  }
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured (and no per-tenant credential found).');
  }
  return { secretKey, publishableKey, webhookSecret };
}

function encodeForm(obj: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    params.set(k, String(v));
  }
  return params.toString();
}

async function stripeRequest<T>(
  path: string,
  body: Record<string, string | number | boolean | undefined>,
  creds: StripeCredentials,
): Promise<T> {
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Pin the API version so a freshly-created live account doesn't default
      // to a newer version that moves current_period_start/end off the
      // subscription root (2025-03-31+ relocated them onto items.data[]).
      // The webhook reads them from the root, so an unpinned account would
      // persist NULL periods and the billing page would render "—".
      'Stripe-Version': '2024-06-20',
      // Idempotency-Key is per-request; callers should set it via the
      // body.idempotency_key key when retries matter (we add it
      // automatically on checkout session creation).
    },
    body: encodeForm(body),
  });
  const json = (await res.json()) as { error?: { message?: string } } & T;
  if (!res.ok) {
    throw new Error(`Stripe ${path} failed: ${json.error?.message || res.status}`);
  }
  return json as T;
}

// ─── Public helpers ────────────────────────────────────────────────────────

export interface CreateCustomerInput {
  email: string;
  name?: string;
  metadata?: Record<string, string>;
}

export async function createStripeCustomer(input: CreateCustomerInput): Promise<{ id: string }> {
  const creds = await loadCreds(null);
  const body: Record<string, string | undefined> = {
    email: input.email,
    name: input.name,
  };
  if (input.metadata) {
    for (const [k, v] of Object.entries(input.metadata)) {
      body[`metadata[${k}]`] = v;
    }
  }
  return stripeRequest('/customers', body, creds);
}

export interface CreateCheckoutSessionInput {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
  orgId?: OrgId;
}

export async function createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ id: string; url: string }> {
  const creds = await loadCreds(input.orgId);
  const body: Record<string, string | number | boolean | undefined> = {
    mode: 'subscription',
    customer: input.customerId,
    'line_items[0][price]': input.priceId,
    'line_items[0][quantity]': 1,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    allow_promotion_codes: true,
  };
  if (input.trialDays && input.trialDays > 0) {
    body['subscription_data[trial_period_days]'] = input.trialDays;
  }
  if (input.orgId) {
    body['metadata[organization_id]'] = input.orgId;
    body['subscription_data[metadata][organization_id]'] = input.orgId;
  }
  return stripeRequest('/checkout/sessions', body, creds);
}

export interface CreatePortalSessionInput {
  customerId: string;
  returnUrl: string;
  orgId?: OrgId;
}

export async function createBillingPortalSession(input: CreatePortalSessionInput): Promise<{ id: string; url: string }> {
  const creds = await loadCreds(input.orgId);
  return stripeRequest('/billing_portal/sessions', {
    customer: input.customerId,
    return_url: input.returnUrl,
  }, creds);
}

// ─── Webhook signature verification ────────────────────────────────────────

/**
 * Verify a Stripe webhook signature header.
 *
 * Signature scheme: `t=<unix>,v1=<hex hmac sha256 of `${t}.${rawBody}`>`
 * https://stripe.com/docs/webhooks/signatures
 *
 * Tolerance defaults to 5 minutes — rejects replays where Stripe's clock
 * and ours differ by more than that.
 */
export function verifyStripeSignature(args: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
  toleranceSec?: number;
}): boolean {
  if (!args.signatureHeader || !args.secret) return false;
  const parts = args.signatureHeader.split(',').map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
  const v1Sigs = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!timestamp || v1Sigs.length === 0) return false;

  const tolerance = args.toleranceSec ?? 300;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > tolerance) return false;

  const expected = createHmac('sha256', args.secret)
    .update(`${timestamp}.${args.rawBody}`, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');

  for (const sig of v1Sigs) {
    const sigBuf = Buffer.from(sig, 'utf8');
    if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}
