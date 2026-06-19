/**
 * Action registry — named, permission-gated mutations the station builder can
 * bind to block rows. Actions are thin descriptors over EXISTING API routes:
 * no business logic, no fetch wrappers with side decisions — the route
 * already owns validation, auth, idempotency and audit. The builder only
 * SELECTS among them; it never grants permissions.
 */

import type { ActionDefinition, ActionMeta, DataSourceDefinition } from './contract';

const registry = new Map<string, ActionDefinition>();

export function registerAction(def: ActionDefinition): void {
  if (registry.has(def.id)) {
    throw new Error(`Station action already registered: ${def.id}`);
  }
  registry.set(def.id, def);
}

export function getAction(id: string): ActionDefinition | undefined {
  return registry.get(id);
}

export function listActions(): ActionDefinition[] {
  return [...registry.values()];
}

export function listActionMeta(): ActionMeta[] {
  return listActions().map(({ body: _b, ...meta }) => meta);
}

/**
 * The Config Sheet's Actions tab = all registered actions compatible with the
 * bound source: same integration, or an `appliesTo` kind present in the
 * source's declared shape.
 */
export function actionsForSource(source: Pick<DataSourceDefinition, 'integration' | 'shape'>): ActionDefinition[] {
  const kinds = new Set(source.shape.map((f) => f.kind));
  return listActions().filter(
    (a) => a.integration === source.integration || a.appliesTo.some((k) => kinds.has(k)),
  );
}

/** Test-only. */
export function __clearActionRegistry(): void {
  registry.clear();
}

// ─── Builtin actions ─────────────────────────────────────────

/** Move a PO email to the ignore pile — wraps PATCH /api/admin/po-gmail/triage/[id]. */
const dismissEmail: ActionDefinition = {
  id: 'incoming.dismiss_email',
  label: 'Dismiss',
  icon: 'X',
  endpoint: { method: 'PATCH', path: '/api/admin/po-gmail/triage/:id' },
  body: () => ({ pile: 'ignore' }),
  permission: 'admin.view',
  appliesTo: [],
  integration: 'po-gmail',
  confirm: 'soft',
};

/** Mark a PO email handled (done pile) — wraps PATCH /api/admin/po-gmail/triage/[id]. */
const markEmailDone: ActionDefinition = {
  id: 'incoming.mark_email_done',
  label: 'Mark handled',
  icon: 'Check',
  endpoint: { method: 'PATCH', path: '/api/admin/po-gmail/triage/:id' },
  body: () => ({ pile: 'done' }),
  permission: 'admin.view',
  appliesTo: [],
  integration: 'po-gmail',
  confirm: 'none',
};

/**
 * Mark a sourcing-queue row as actively being worked — wraps PATCH
 * /api/sourcing/alerts (id+status in the body; this route keys the id off the
 * body, not the path). Resolve/dismiss stay out of the station builder because
 * they're reason-required; "start sourcing" is the safe done-action.
 */
const startSourcing: ActionDefinition = {
  id: 'sourcing.start_sourcing',
  label: 'Start sourcing',
  icon: 'Search',
  endpoint: { method: 'PATCH', path: '/api/sourcing/alerts' },
  body: (row) => ({ id: Number(row.id), status: 'sourcing' }),
  permission: 'sourcing.manage',
  appliesTo: [],
  integration: 'sourcing',
  confirm: 'none',
};

/**
 * Attach a carrier tracking number to a PO. Fires a custom window event
 * (`station:attach-tracking`) carrying the row's `po_id` + `po_number` so the
 * IncomingAttachTrackingPopover can pick it up and open pre-filled for this PO.
 *
 * The popover handles validation, the actual POST to /api/receiving/po/:id/attach-box,
 * and cache invalidation — the action descriptor only advertises the intent.
 */
const attachTracking: ActionDefinition = {
  id: 'incoming.attach_tracking',
  label: 'Attach tracking',
  icon: 'Link2',
  endpoint: { method: 'POST', path: '/api/receiving/po/:id/attach-box' },
  // body is omitted — BlockRenderer detects `station:attach-tracking` event actions
  // and dispatches the window event instead of calling fetch directly.
  permission: 'receiving.mark_received',
  appliesTo: ['po_ref'],
  integration: 'receiving',
  confirm: 'none',
};

let builtinsRegistered = false;
export function registerBuiltinActions(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  registerAction(dismissEmail);
  registerAction(markEmailDone);
  registerAction(startSourcing);
  registerAction(attachTracking);
}
