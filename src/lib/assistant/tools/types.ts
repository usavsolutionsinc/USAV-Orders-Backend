/**
 * Assistant read-tool registry — shared shapes (plan §3.1).
 *
 * A tool is a small, typed, org-scoped read the model composes per question.
 * The entry shape is deliberately transport-agnostic: `name` + `description` +
 * a Zod `inputSchema` (JSON-schema derivable via z.toJSONSchema) + a pure
 * `run` — so the same registry can later back MCP without rework (§-2 "AI
 * runtime"). Adding a capability = registering a tool; no migration.
 *
 * Org scoping is structural: every tool receives an AssistantToolCtx whose
 * `organizationId` comes from the authenticated request (never the model),
 * and every SQL statement leads with an explicit organization_id predicate on
 * top of the tenant-pool GUC (tenantQuery).
 */

import type { z } from 'zod';
import type { OrgId } from '@/lib/tenancy/constants';
import type { PermissionString } from '@/lib/auth/permissions-shared';

export interface AssistantToolCtx {
  organizationId: OrgId;
  staffId: number | null;
  /** The caller's resolved permission set (from AuthContext). */
  permissions: ReadonlySet<string>;
}

export interface AssistantToolQueryResult {
  rows: Array<Record<string, unknown>>;
}

/** Injected DB seam — defaults to tenantQuery (GUC + explicit org predicate). */
export interface AssistantToolDeps {
  query: (orgId: OrgId, text: string, params?: ReadonlyArray<unknown>) => Promise<AssistantToolQueryResult>;
}

export interface AssistantToolDef<Schema extends z.ZodTypeAny = z.ZodTypeAny, Out = unknown> {
  name: string;
  /** Written for the model — say what questions this answers and what comes back. */
  description: string;
  /** Permission required to invoke (checked against ctx.permissions). */
  permission: PermissionString;
  inputSchema: Schema;
  run: (input: z.infer<Schema>, ctx: AssistantToolCtx, deps: AssistantToolDeps) => Promise<Out>;
}

export type AssistantToolRunResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code: 'unknown_tool' | 'forbidden' | 'invalid_input' | 'tool_error' };
