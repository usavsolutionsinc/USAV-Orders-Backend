export const OPS_PLAN_STATIONS = [
  'RECEIVING',
  'TECH',
  'PACK',
  'FBA',
  'LABELS',
  'ADMIN',
] as const;

export type OpsPlanStation = (typeof OPS_PLAN_STATIONS)[number];

export const OPS_PLAN_STATUSES = ['draft', 'active', 'paused', 'done', 'archived'] as const;
export type OpsPlanStatus = (typeof OPS_PLAN_STATUSES)[number];

export const OPS_PLAN_PHASE_STATUSES = ['open', 'in_progress', 'done', 'canceled'] as const;
export type OpsPlanPhaseStatus = (typeof OPS_PLAN_PHASE_STATUSES)[number];

export const OPS_PLAN_TASK_STATUSES = ['open', 'in_progress', 'done', 'canceled'] as const;
export type OpsPlanTaskStatus = (typeof OPS_PLAN_TASK_STATUSES)[number];

export const OPS_PLAN_TASK_LINK_TYPES = ['work_assignment', 'inventory_event', 'manual'] as const;
export type OpsPlanTaskLinkType = (typeof OPS_PLAN_TASK_LINK_TYPES)[number];

export const INBOX_ITEM_SOURCES = ['plan_task', 'work_assignment'] as const;
export type InboxItemSource = (typeof INBOX_ITEM_SOURCES)[number];

/** Maps work-order queue keys to operations-catalog stations for inbox filtering. */
export const QUEUE_KEY_TO_STATION: Record<string, OpsPlanStation | null> = {
  orders: 'TECH',
  test_returns: 'RECEIVING',
  test_receiving: 'RECEIVING',
  local_pickups: 'RECEIVING',
  fba_shipments: 'FBA',
  repair_services: 'TECH',
  stock_replenish: 'ADMIN',
};
