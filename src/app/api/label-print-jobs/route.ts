import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import { recordLabelPrintJob } from '@/lib/labels/print-jobs';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

/**
 * POST /api/label-print-jobs
 *
 * Bridge that records client-side (browser-ZPL) label prints into the
 * `label_print_jobs` ledger — the prints that DON'T flow through post-multi-sn
 * (bulk history reprints, LPN labels, reprint mode). Until the print spooler
 * moves server-side (plan Phase 4), the browser prints and then POSTs the job
 * record here so the ledger stays complete.
 *
 * Idempotent per `(org, clientEventId)` — a retry returns the original row.
 * `actorStaffId` is taken from the session, never the body. Auth: `print.label`.
 */
const JobSchema = z.object({
  jobType: z.enum(['UNIT', 'MANIFEST', 'HANDLING_UNIT', 'REPRINT']),
  serialUnitId: z.number().int().positive().nullable().optional(),
  manifestId: z.number().int().positive().nullable().optional(),
  handlingUnitId: z.number().int().positive().nullable().optional(),
  unitUid: z.string().trim().min(1).nullable().optional(),
  qrPayload: z.string().trim().min(1),
  symbology: z.string().trim().min(1).nullable().optional(),
  templateId: z.string().trim().min(1).nullable().optional(),
  printerProfileId: z.number().int().positive().nullable().optional(),
  copies: z.number().int().min(1).max(999).nullable().optional(),
  isReprint: z.boolean().nullable().optional(),
  reprintOfId: z.number().int().positive().nullable().optional(),
  clientEventId: z.string().trim().min(1).nullable().optional(),
});

const BodySchema = z.object({
  jobs: z.array(JobSchema).min(1).max(500),
});

export const POST = withAuth(
  async (request, ctx) => {
    const orgId = ctx.organizationId as OrgId;
    const raw = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid body', issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    try {
      const rows = await Promise.all(
        parsed.data.jobs.map((j) =>
          recordLabelPrintJob({ ...j, actorStaffId: ctx.staffId ?? null }, orgId),
        ),
      );
      const jobs = rows.filter((r): r is NonNullable<typeof r> => r != null);
      return NextResponse.json({ ok: true, recorded: jobs.length, jobs });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'label-print-jobs failed';
      console.error('[POST /api/label-print-jobs] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'print.label' },
);
