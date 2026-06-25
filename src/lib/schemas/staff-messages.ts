import { z } from 'zod';

/**
 * Request schemas for /api/staff-messages — the header clipboard "send to
 * staff" flow. Kept client-safe (no pg import) so the typed fetch helpers and
 * the clipboard popover can share them.
 */

/** Where the message came from. Extensible without a schema/table change. */
export const StaffMessageKind = z.enum([
  'copied_text',
  'note',
  'seller_claim_message',
  'support_assignment',
]);
export type StaffMessageKind = z.infer<typeof StaffMessageKind>;

export const StaffMessageCreateBody = z.object({
  /** Recipient staff id — validated server-side to be a live staffer in the sender's org. */
  recipientId: z.number().int().positive(),
  body: z.string().trim().min(1).max(5000),
  kind: StaffMessageKind.optional().default('copied_text'),
  /** Optional provenance for typed rendering, e.g. { tone: 'tracking', display: '…1234' }. */
  context: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().max(200).optional(),
});
export type StaffMessageCreateBody = z.infer<typeof StaffMessageCreateBody>;

export const StaffMessagePatchBody = z.discriminatedUnion('action', [
  // Mark a single received message read (idempotent).
  z.object({
    action: z.literal('mark_read'),
    id: z.number().int().positive(),
  }),
  // Mark the whole inbox read in one shot.
  z.object({
    action: z.literal('mark_all_read'),
  }),
]);
export type StaffMessagePatchBody = z.infer<typeof StaffMessagePatchBody>;
