/**
 * Receiving spine — the canonical, genuinely-shared surface every street imports.
 *
 * Plan: docs/todo/polymorphic-tables-database-refactor-plan.md §4 (Layer 1/3).
 *
 * This barrel does NOT re-implement anything; it re-exports the existing
 * chokepoints (status transition, dock scan, unit receive, serial attach, carton
 * box attach, exceptions) plus the Layer-2 facts surface, the polymorphic intake
 * -kind registry, and the facts-sync write glue. A street imports from
 * `@/lib/receiving/spine` and gets exactly the shared primitives — and nothing
 * street-specific, which stays in each street's own lane.
 *
 * Invariant: status changes go through transitionReceivingLine (never a raw
 * UPDATE workflow_status); facts go through the facts helpers / syncLineFacts.
 */

// ── Shared chokepoints (status / scan / receive / attach / exception) ───────
export { transitionReceivingLine, guardReceivingLine } from '../state-machine';
export { recordReceivingScan } from '../record-scan';
export { receiveLineUnits } from '../receive-line';
export { attachSerialToLine } from '../serial-attach';
export { attachBoxToReceiving, ensureReceivingForPo, ensureReceivingForEbayOrder } from '../attach-box';
export {
  recordReceivingException,
  listReceivingLineExceptions,
  resolveReceivingExceptions,
} from '../exceptions';

// ── Layer 2 — typed facts (registry + narrow tables + write glue) ───────────
export * from '../facts';
export * from './facts-sync';

// ── Polymorphic intake-kind discriminator ───────────────────────────────────
export * from '../kinds/registry';
