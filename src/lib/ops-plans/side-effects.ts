import type { NextRequest } from 'next/server';
import { after } from 'next/server';
import pool from '@/lib/db';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { publishOpsPlanUpdated } from '@/lib/realtime/publish';
import type { AuthContext } from '@/lib/auth/auth-context';

export const OPS_PLANS_AUDIT_SOURCE = 'ops-plans-api';

export function mapOpsPlanError(err: unknown): { status: number; error: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'PLAN_ACTIVATE_REQUIRES_TASKS') return { status: 409, error: message };
  if (message === 'INVALID_ASSIGNEE') return { status: 400, error: message };
  if (message === 'INVALID_TRANSITION') return { status: 409, error: message };
  if (message === 'ALREADY_ASSIGNED') return { status: 409, error: message };
  if (message === 'NOT_ASSIGNEE') return { status: 403, error: message };
  return { status: 500, error: 'INTERNAL_ERROR' };
}

export function scheduleOpsPlanSideEffects(
  orgId: string,
  planId: string,
  event: 'plan_updated' | 'task_assigned' | 'task_completed' | 'phase_done',
  opts: {
    taskId?: string;
    ctx?: AuthContext;
    req?: NextRequest;
    audit?: {
      action: string;
      entityType: string;
      entityId: string;
      before?: unknown;
      after?: unknown;
      reasonCode?: string;
    };
  } = {},
) {
  after(async () => {
    try {
      await publishOpsPlanUpdated({
        organizationId: orgId,
        planId,
        taskId: opts.taskId,
        event,
        source: OPS_PLANS_AUDIT_SOURCE,
      });
    } catch (e) {
      console.warn('[ops-plans] Ably publish failed:', e);
    }
    if (opts.audit && opts.ctx && opts.req) {
      try {
        await recordAudit(pool, opts.ctx, opts.req, {
          source: OPS_PLANS_AUDIT_SOURCE,
          action: opts.audit.action,
          entityType: opts.audit.entityType,
          entityId: opts.audit.entityId,
          before: opts.audit.before as Record<string, unknown> | null | undefined,
          after: opts.audit.after as Record<string, unknown> | null | undefined,
          reasonCode: opts.audit.reasonCode ?? null,
        });
      } catch (e) {
        console.warn('[ops-plans] audit failed:', e);
      }
    }
  });
}

export { AUDIT_ACTION, AUDIT_ENTITY };
