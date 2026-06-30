/**
 * Facts-sync — the write glue between the receiving spine and Layer 2.
 *
 * Plan: docs/todo/polymorphic-tables-database-refactor-plan.md §4 (Layer 2/3).
 *
 * A street, after it creates/advances a line through the spine chokepoints,
 * persists that line's typed facts in ONE call: it passes only the facts it owns
 * (testing sets the testing bundle; the door sets the return/zoho bundle; etc.)
 * and this routes each to its narrow facts table or the registry. Partial — an
 * omitted section is not touched.
 *
 * Org-scoped + Deps-injected (delegates to the facts helpers' defaults).
 */

import type { OrgId } from '@/lib/tenancy/constants';
import type { FactsDeps } from '../facts/store';
import {
  upsertReceivingLineZoho,
  upsertReceivingLineTesting,
  upsertReceivingLineReturn,
  upsertReceivingLinePutaway,
  type ZohoFactsInput,
  type TestingFactsInput,
  type ReturnFactsInput,
  type PutawayFactsInput,
} from '../facts/narrow';
import { writeLineFact } from '../facts/store';

export interface LineFactsBundle {
  zoho?: ZohoFactsInput;
  testing?: TestingFactsInput;
  returns?: ReturnFactsInput;
  putaway?: PutawayFactsInput;
  /** receiving_line_facts registry rows keyed by fact_kind (validated on write). */
  custom?: Record<string, unknown>;
}

/**
 * Persist every provided facts section for a line. Each registry fact is
 * validated against its schema (throws on a malformed payload). Returns nothing;
 * read back with the typed readers if needed.
 */
export async function syncLineFacts(
  orgId: OrgId,
  receivingLineId: number,
  bundle: LineFactsBundle,
  deps?: FactsDeps,
): Promise<void> {
  if (bundle.zoho) await upsertReceivingLineZoho(orgId, receivingLineId, bundle.zoho, deps);
  if (bundle.testing) await upsertReceivingLineTesting(orgId, receivingLineId, bundle.testing, deps);
  if (bundle.returns) await upsertReceivingLineReturn(orgId, receivingLineId, bundle.returns, deps);
  if (bundle.putaway) await upsertReceivingLinePutaway(orgId, receivingLineId, bundle.putaway, deps);
  if (bundle.custom) {
    for (const [kind, payload] of Object.entries(bundle.custom)) {
      await writeLineFact(orgId, receivingLineId, kind, payload, deps);
    }
  }
}
