/**
 * Beta application intake — validation schema + pure helpers.
 *
 * The ontology-based question schema for POST /api/beta/apply
 * (docs/todo/beta-intake-funnel-plan.md §4): answers are keyed by the
 * product's own vocabulary so they aggregate structurally across companies
 * and map onto workflow_definitions/nodes/edges. This module is deliberately
 * DB-free and Next-free so the route stays thin and the validation edge
 * cases unit-test without a server (see apply-schema.test.ts).
 *
 * Two tiers share one endpoint (plan §9 wires the marketing waitlist form to
 * tier: 'waitlist'): the paid 'application' tier answers the full ~12-question
 * set; the free 'waitlist' tier answers only { businessType, monthlyVolume,
 * topPain }.
 */

import { z } from 'zod';

// ── Vocabulary (mirrors beta_applications CHECK constraints) ────────────────

export const BETA_APPLICATION_TIERS = ['waitlist', 'application'] as const;
export type BetaApplicationTier = (typeof BETA_APPLICATION_TIERS)[number];

export const BETA_APPLICATION_STATUSES = [
  'RECEIVED',
  'UNDER_REVIEW',
  'ACCEPTED',
  'REFUNDED',
  'REJECTED',
] as const;
export type BetaApplicationStatus = (typeof BETA_APPLICATION_STATUSES)[number];

export function isBetaApplicationStatus(s: string): s is BetaApplicationStatus {
  return (BETA_APPLICATION_STATUSES as readonly string[]).includes(s);
}

// ── Ontology enums (plan §4 — one id per pick option) ───────────────────────

export const BUSINESS_TYPES = ['ebay_store', 'fba_heavy', 'liquidation', 'repair_resale', 'mixed'] as const;
export const VOLUME_BANDS = ['under_100', '100_500', '500_2000', 'over_2000'] as const;
export const FLOOR_STATIONS = ['receiving', 'testing_qc', 'repair', 'listing', 'packing', 'fba_prep', 'returns_support'] as const;
export const TEST_FAIL_PATHS = ['fix', 'part_out', 'sell_as_is', 'trash'] as const;
export const SALES_CHANNELS = ['ebay', 'amazon_fbm', 'amazon_fba', 'own_site', 'local_walk_in', 'wholesale', 'other'] as const;
export const CURRENT_TOOLS = ['spreadsheets', 'zoho', 'skulabs', 'vendoo_listperfectly', 'other', 'none'] as const;
export const SCAN_TARGETS = ['tracking', 'serials', 'skus', 'nothing'] as const;
export const TEAM_SIZE_BANDS = ['solo', '2_5', '6_15', 'over_15'] as const;
export const GRADING_METHODS = ['no_grading', 'ad_hoc', 'defined_scale'] as const;

const freeText = (max: number) => z.string().trim().max(max);

/** Full application-tier answer set (Q1–Q12; Q10/Q11 required, Q12 optional). */
export const ApplicationAnswersSchema = z.object({
  businessType: z.enum(BUSINESS_TYPES),                                   // Q1 → segment
  monthlyVolume: z.enum(VOLUME_BANDS),                                    // Q2 → sizing
  stations: z.array(z.enum(FLOOR_STATIONS)).min(1).max(FLOOR_STATIONS.length), // Q3 → graph nodes
  testFailPath: z.enum(TEST_FAIL_PATHS),                                  // Q4 → repair-loop edges
  salesChannels: z.array(z.enum(SALES_CHANNELS)).min(1),                  // Q5 → listing lanes
  /** Optional rough % split keyed by channel id (Q5's "+ %"). partialRecord: only the channels they sell on. */
  channelSplit: z.partialRecord(z.enum(SALES_CHANNELS), z.number().min(0).max(100)).optional(),
  currentTools: z.array(z.enum(CURRENT_TOOLS)).min(1),                    // Q6 → integration priority
  scansToday: z.array(z.enum(SCAN_TARGETS)).min(1),                       // Q7 → scan-first readiness
  teamSize: z.enum(TEAM_SIZE_BANDS),                                      // Q8 → seats
  conditionGrading: z.enum(GRADING_METHODS),                              // Q9 → grading module
  conditionGradingDetail: freeText(500).optional(),                       // Q9 "how?"
  fixFirst: freeText(2000).min(1),                                        // Q10 → roadmap voting
  noBrainer: freeText(2000).min(1),                                       // Q11 → objection mining
  unusual: freeText(2000).optional(),                                     // Q12 → edge cases
});
export type ApplicationAnswers = z.infer<typeof ApplicationAnswersSchema>;

/** Waitlist tier asks only: business type, volume band, top pain (plan §4). */
export const WaitlistAnswersSchema = z.object({
  businessType: z.enum(BUSINESS_TYPES),
  monthlyVolume: z.enum(VOLUME_BANDS),
  topPain: freeText(500).min(1),
});
export type WaitlistAnswers = z.infer<typeof WaitlistAnswersSchema>;

// ── Envelope ─────────────────────────────────────────────────────────────────

const BaseApplySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  companyName: z.string().trim().max(160).optional(),
  /**
   * Honeypot — a field humans never see (rendered off-screen on the form).
   * Bots that fill every input trip it. Must be absent or empty; the route
   * answers a fake 200 without writing anything (see isHoneypotTripped).
   */
  website: z.string().max(0).optional(),
});

export const BetaApplySchema = z.discriminatedUnion('tier', [
  BaseApplySchema.extend({ tier: z.literal('application'), answers: ApplicationAnswersSchema }),
  BaseApplySchema.extend({ tier: z.literal('waitlist'), answers: WaitlistAnswersSchema }),
]);
export type BetaApply = z.infer<typeof BetaApplySchema>;

/**
 * Honeypot check runs BEFORE Zod so a bot gets an indistinguishable 200
 * instead of a schema error it could learn from. Tripped = the hidden
 * `website` field arrived non-empty.
 */
export function isHoneypotTripped(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const v = (body as Record<string, unknown>).website;
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Stripe Payment Link URL for the response — env-configured, echoed with
 * client_reference_id=<application id> so the manual v1 reconcile (plan §7)
 * can match a checkout back to its row. No live Stripe call (owner-gated).
 * Returns null when the link is unconfigured or malformed (the form then
 * shows its "payment link coming soon" fallback instead of a broken href).
 */
export function buildPaymentLinkUrl(base: string | undefined | null, applicationId: string): string | null {
  if (!base) return null;
  try {
    const url = new URL(base);
    url.searchParams.set('client_reference_id', applicationId);
    return url.toString();
  } catch {
    return null;
  }
}
