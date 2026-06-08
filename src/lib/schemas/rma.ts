import { z } from 'zod';

const trimmed = z.string().trim();

// ─── PATCH /api/rma/[id] ────────────────────────────────────────────────────
//
// Only mutable record metadata. `direction`, `status`, `order_id` etc. are not
// editable here — status moves through the dedicated lifecycle verb routes.
// Keys are snake_case to match the rest of the RMA API surface (POST /api/rma).

export const RmaUpdateBody = z
  .object({
    expected_carrier: trimmed.min(1).optional(),
    expires_at: trimmed.min(1).optional(),
    notes: trimmed.min(1).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, {
    message: 'At least one field must be provided',
  });
