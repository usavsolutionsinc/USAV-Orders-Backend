/**
 * POST /api/org/accounts/merge — fold a duplicate account into a survivor.
 *
 * The admin half of the multi-org enabler: when the same human exists as two
 * accounts (commonly the Phase-1 backfill that made each per-org staff its own
 * account), an admin merges the duplicate into the survivor. The domain helper
 * (mergeAccounts) re-points memberships, staff profiles, federated identities,
 * and passkeys, then soft-marks the merged account — all in one transaction,
 * idempotent on re-run, and guarded by the verified-email same-human gate.
 *
 * Gated by admin.manage_staff (same as invitations). The merge touches GLOBAL
 * identity tables; ctx.organizationId scopes the transaction envelope only.
 *
 * See docs/identity-layer-plan.md.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import {
  mergeAccounts,
  AccountMergeError,
  type AccountMergeErrorCode,
} from '@/lib/identity/accounts';

const Body = z.object({
  survivorAccountId: z.string().uuid(),
  mergedAccountId: z.string().uuid(),
});

/** Map a merge guard failure to an HTTP status. */
function statusForMergeError(code: AccountMergeErrorCode): number {
  switch (code) {
    case 'SURVIVOR_NOT_FOUND':
    case 'MERGED_NOT_FOUND':
      return 404;
    case 'SAME_ACCOUNT':
      return 400;
    // Precondition / conflict failures (already-merged, inactive, email gate).
    default:
      return 409;
  }
}

export const POST = withAuth(async (req, ctx) => {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', detail: err instanceof Error ? err.message : 'bad request' },
      { status: 400 },
    );
  }

  try {
    const result = await mergeAccounts({
      survivorAccountId: parsed.survivorAccountId,
      mergedAccountId: parsed.mergedAccountId,
      orgId: ctx.organizationId,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AccountMergeError) {
      return NextResponse.json({ error: err.code }, { status: statusForMergeError(err.code) });
    }
    throw err;
  }
}, {
  permission: 'admin.manage_staff',
  audit: {
    source: 'admin',
    action: 'account.merge',
    entityType: 'account',
    // Anchor the audit row on the survivor (the account that lives on).
    entityId: ({ response }) =>
      (response as { survivorAccountId?: string })?.survivorAccountId ?? null,
    extra: ({ response }) => {
      const r = response as MergeResponse | null;
      if (!r) return {};
      return {
        merged_account_id: r.mergedAccountId,
        idempotent: r.idempotent,
        repointed: r.repointed,
      };
    },
  },
});

interface MergeResponse {
  survivorAccountId: string;
  mergedAccountId: string;
  idempotent: boolean;
  repointed: { memberships: number; staff: number; identities: number; passkeys: number };
}
