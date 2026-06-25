import Ably from 'ably';
import { getValidatedAblyApiKey } from '@/lib/realtime/ably-key';
import pool from '@/lib/db';
import {
  getAiAssistSessionChannelName,
  getDashboardChannelName,
  getFbaChannelName,
  getInboxChannelName,
  getOrdersChannelName,
  getPackerBridgeChannelName,
  getRepairsChannelName,
  getScanLogChannelName,
  getStaffChannelName,
  getStationChannelName,
} from '@/lib/realtime/channels';
import { createStationActivityLog } from '@/lib/station-activity';
import { getPrimaryTechStaffIds } from '@/lib/neon/staff-stations-queries';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';
import { formatPSTTimestamp } from '@/utils/date';

// Every payload carries `organizationId` so the channel it publishes to is
// org-namespaced. Route handlers pass `ctx.organizationId`; the transitional
// jobs (orders-ingest-drain, fulfillment-sync, …) pass `transitionalUsavOrgId()`.

type OrderChangedPayload = {
  organizationId: string;
  orderIds: number[];
  source: string;
};

type OrderTestedPayload = {
  organizationId: string;
  orderId: number;
  testedBy: number | null;
  source: string;
};

type RepairChangedPayload = {
  organizationId: string;
  repairIds: number[];
  source: string;
};

type AiAssistantPayload = {
  organizationId: string;
  channel?: string;
  sessionId: string;
  prompt: string;
  answer: string;
  model: string;
};

type TechLogChangedPayload = {
  organizationId: string;
  techId: number;
  action: 'insert' | 'update' | 'delete';
  rowId?: number;
  row?: Record<string, unknown>;
  source: string;
};

type PackerLogChangedPayload = {
  organizationId: string;
  packerId: number;
  action: 'insert' | 'update' | 'delete';
  packerLogId?: number;
  row?: Record<string, unknown>;
  source: string;
};

type ReceivingLogChangedPayload = {
  organizationId: string;
  action: 'insert' | 'update' | 'delete';
  rowId?: string;
  row?: Record<string, unknown>;
  source: string;
  /**
   * Terminal Zoho purchase-receive verdict for this line, emitted from the
   * mark-received-po background sync so the inline receive checklist can
   * reconcile its optimistic green checks: 'ok' confirms, 'failed' flips the
   * card to a retryable failure. Omitted for non-receive updates.
   */
  zohoReceive?: 'ok' | 'failed' | 'skipped';
};

type ReceivingPhotoChangedPayload = {
  organizationId: string;
  action: 'insert' | 'delete';
  receivingId: number;
  receivingLineId?: number | null;
  photoId?: number | null;
  totalPhotoCount?: number | null;
  source: string;
};

type PackerPhotoChangedPayload = {
  organizationId: string;
  action: 'insert' | 'delete';
  packerLogId: number;
  /** Human order number (poRef) the photo is filed under in the library. */
  orderId?: string | null;
  photoId?: number | null;
  totalPhotoCount?: number | null;
  source: string;
};

type DashboardUpdatePayload = {
  organizationId: string;
  type: 'kpi_update' | 'activity_event' | 'distribution_update' | 'staff_progress_update';
  category?: string;
  update?: any;
  data?: any;
};

type StaffScheduleChangedPayload = {
  organizationId: string;
  action: 'single' | 'bulk';
  source: string;
  changed: Array<{
    staff_id: number;
    day_of_week: number;
    schedule_date?: string | null;
    is_scheduled: boolean;
  }>;
};

let ablyRestClient: Ably.Rest | null = null;

function getAblyRestClient() {
  const key = getValidatedAblyApiKey();
  if (!key) return null;

  if (!ablyRestClient) {
    ablyRestClient = new Ably.Rest({ key });
  }
  return ablyRestClient;
}

async function publishEvent(channel: string, name: string, data: Record<string, unknown>) {
  const client = getAblyRestClient();
  if (!client) return;
  const normalizedChannel = String(channel || '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!normalizedChannel) return;

  try {
    await client.channels.get(normalizedChannel).publish(name, data);
    void logRealtimeEventToStationActivity(normalizedChannel, name, data);
  } catch (error) {
    console.error(`[realtime] Failed to publish "${name}" on "${normalizedChannel}":`, error);
  }
}

export async function publishDashboardUpdate(payload: DashboardUpdatePayload) {
  await publishEvent(getDashboardChannelName(payload.organizationId), payload.type, {
    ...payload,
    timestamp: formatPSTTimestamp(),
  });
}

export type VoiceEventPayload = {
  organizationId: string;
  /** What changed, so the client knows which query keys to invalidate. */
  kind: 'call' | 'voicemail';
  /** 'created' | 'updated' — voicemail follow-up resolution also rides 'updated'. */
  change: 'created' | 'updated';
  callEventId?: number | null;
  voicemailId?: number | null;
};

/**
 * Nudge the Support page that a call/voicemail landed or changed, so the
 * Voicemail Workbench and Call Log Monitor refetch (they invalidate
 * `['voicemails']` / `['call-events']` on receipt). Broadcast on the org
 * dashboard channel — there is no per-user targeting here (the bell
 * notification for an assigned follow-up rides publishStaffMessage instead).
 */
export async function publishVoiceEvent(payload: VoiceEventPayload) {
  await publishEvent(getDashboardChannelName(payload.organizationId), 'voice_event', {
    type: 'voice_event',
    kind: payload.kind,
    change: payload.change,
    callEventId: payload.callEventId ?? null,
    voicemailId: payload.voicemailId ?? null,
    timestamp: formatPSTTimestamp(),
  });
}

function parseFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function logRealtimeEventToStationActivity(
  channel: string,
  eventName: string,
  payload: Record<string, unknown>,
) {
  // Skip self-published feed events and high-churn structural updates.
  if (
    eventName === 'activity.logged'
    || eventName === 'order.changed'
    || eventName === 'order.assignments'
    || eventName === 'queue.assignments'
    || eventName === 'tech-log.changed'
    || eventName === 'packer-log.changed'
    || eventName === 'fba.shipment.changed'
    || eventName === 'fba.catalog.changed'
    || eventName === 'ai.assistant.reply'
    || eventName === 'kpi_update'
    || eventName === 'activity_event'
    || eventName === 'distribution_update'
    || eventName === 'staff_progress_update'
    || eventName === 'staff.schedule.changed'
  ) {
    return;
  }

  // This self-derived station-activity feed has no request context; it stamps
  // the transitional org (USAV) — it is single-tenant by construction today.
  const selfOrgId = transitionalUsavOrgId();

  try {
    if (eventName === 'order.tested') {
      const orderId = parseFiniteNumber(payload.orderId);
      const staffId = parseFiniteNumber(payload.testedBy);
      const id = await createStationActivityLog(pool, {
        organizationId: selfOrgId,
        station: 'TECH',
        activityType: 'WS_ORDER_TESTED',
        staffId,
        scanRef: orderId != null ? String(orderId) : null,
        notes: orderId != null ? `Realtime order.tested for order ${orderId}` : 'Realtime order.tested',
        metadata: { channel, eventName, source: payload.source ?? null },
      });
      if (!id) return;
      await publishActivityLogged({
        organizationId: selfOrgId,
        id,
        station: 'TECH',
        activityType: 'WS_ORDER_TESTED',
        staffId,
        scanRef: orderId != null ? String(orderId) : null,
        source: String(payload.source || 'realtime.order.tested'),
      });
      return;
    }

    if (eventName === 'repair.changed') {
      const repairIds = Array.isArray(payload.repairIds)
        ? payload.repairIds.map((value) => parseFiniteNumber(value)).filter((value): value is number => value != null)
        : [];
      const id = await createStationActivityLog(pool, {
        organizationId: selfOrgId,
        station: 'ADMIN',
        activityType: 'WS_REPAIR_CHANGED',
        staffId: null,
        notes: repairIds.length > 0
          ? `Realtime repair.changed for repair ids: ${repairIds.join(', ')}`
          : 'Realtime repair.changed',
        metadata: { channel, eventName, source: payload.source ?? null, repairIds },
      });
      if (!id) return;
      await publishActivityLogged({
        organizationId: selfOrgId,
        id,
        station: 'ADMIN',
        activityType: 'WS_REPAIR_CHANGED',
        staffId: null,
        source: String(payload.source || 'realtime.repair.changed'),
      });
      return;
    }

    if (eventName === 'receiving-log.changed') {
      const rowId = payload.rowId == null ? null : String(payload.rowId);
      const action = payload.action == null ? null : String(payload.action);
      const id = await createStationActivityLog(pool, {
        organizationId: selfOrgId,
        station: 'RECEIVING',
        activityType: 'WS_RECEIVING_CHANGED',
        staffId: null,
        scanRef: rowId,
        notes: action ? `Realtime receiving-log.changed (${action})` : 'Realtime receiving-log.changed',
        metadata: { channel, eventName, source: payload.source ?? null, action },
      });
      if (!id) return;
      await publishActivityLogged({
        organizationId: selfOrgId,
        id,
        station: 'RECEIVING',
        activityType: 'WS_RECEIVING_CHANGED',
        staffId: null,
        scanRef: rowId,
        source: String(payload.source || 'realtime.receiving-log.changed'),
      });
      return;
    }

    if (eventName === 'fba.item.changed' && payload.action === 'scan') {
      const shipmentId = parseFiniteNumber(payload.shipmentId);
      const itemId = parseFiniteNumber(payload.itemId);
      const fnsku = payload.fnsku == null ? null : String(payload.fnsku);
      const id = await createStationActivityLog(pool, {
        organizationId: selfOrgId,
        station: 'ADMIN',
        activityType: 'WS_FBA_SCAN',
        staffId: null,
        fnsku,
        fbaShipmentId: shipmentId,
        fbaShipmentItemId: itemId,
        notes: fnsku ? `Realtime FBA scan for ${fnsku}` : 'Realtime FBA scan',
        metadata: { channel, eventName, source: payload.source ?? null },
      });
      if (!id) return;
      await publishActivityLogged({
        organizationId: selfOrgId,
        id,
        station: 'ADMIN',
        activityType: 'WS_FBA_SCAN',
        staffId: null,
        fnsku,
        source: String(payload.source || 'realtime.fba.item.changed'),
      });
    }
  } catch (error) {
    console.error(`[realtime] Failed to log "${eventName}" into station_activity_logs:`, error);
  }
}

export async function publishOrderChanged(payload: OrderChangedPayload) {
  const normalizedIds = payload.orderIds.map(Number).filter((id) => Number.isFinite(id));
  if (normalizedIds.length === 0) return;

  await publishEvent(getOrdersChannelName(payload.organizationId), 'order.changed', {
    type: 'order.changed',
    orderIds: normalizedIds,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export type OrderAssignmentsBroadcastPayload = {
  organizationId: string;
  orderId: number;
  testerId: number | null;
  packerId: number | null;
  testerName: string | null;
  packerName: string | null;
  deadlineAt: string | null;
  source: string;
};

export type QueueAssignmentsBroadcastPayload = {
  organizationId: string;
  entityType: string;
  entityId: number;
  source: string;
};

/** Broadcast ORDER work_assignment staff + deadline to all clients (dashboard queue, station Up Next). */
export async function publishOrderAssignmentsUpdated(payload: OrderAssignmentsBroadcastPayload) {
  const orderId = Number(payload.orderId);
  if (!Number.isFinite(orderId)) return;

  await publishEvent(getOrdersChannelName(payload.organizationId), 'order.assignments', {
    type: 'order.assignments',
    orderId,
    testerId: payload.testerId,
    packerId: payload.packerId,
    testerName: payload.testerName,
    packerName: payload.packerName,
    deadlineAt: payload.deadlineAt,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

/** Non-order work queues (FBA, receiving, repair, SKU stock) — clients refetch Up Next. */
export async function publishQueueAssignmentsUpdated(payload: QueueAssignmentsBroadcastPayload) {
  const entityId = Number(payload.entityId);
  if (!Number.isFinite(entityId)) return;

  await publishEvent(getOrdersChannelName(payload.organizationId), 'queue.assignments', {
    type: 'queue.assignments',
    entityType: String(payload.entityType || '').trim(),
    entityId,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishOrderTested(payload: OrderTestedPayload) {
  const orderId = Number(payload.orderId);
  if (!Number.isFinite(orderId)) return;

  const testedByRaw = payload.testedBy == null ? null : Number(payload.testedBy);
  const testedBy = testedByRaw != null && Number.isFinite(testedByRaw) ? testedByRaw : null;
  await publishEvent(getOrdersChannelName(payload.organizationId), 'order.tested', {
    type: 'order.tested',
    orderId,
    testedBy,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishRepairChanged(payload: RepairChangedPayload) {
  const normalizedIds = payload.repairIds.map(Number).filter((id) => Number.isFinite(id));
  if (normalizedIds.length === 0) return;

  await publishEvent(getRepairsChannelName(payload.organizationId), 'repair.changed', {
    type: 'repair.changed',
    repairIds: normalizedIds,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export type PriorityUnboxPayload = {
  organizationId: string;
  staffId: number;
  trackingNumber: string;
  receivingId: number | null;
  skus: string[];
  source: string;
};

/**
 * Push a "unbox this first" alert to one staff member's inbox channel. Fired
 * when a receiving-door scan matches a SKU needed by a currently-pending order.
 * No-op when there's nothing to alert about.
 */
export async function publishPriorityUnbox(payload: PriorityUnboxPayload) {
  const staffId = Number(payload.staffId);
  if (!Number.isFinite(staffId) || staffId <= 0) return;
  const skus = (payload.skus || []).filter((s) => typeof s === 'string' && s.length > 0);
  if (skus.length === 0) return;

  await publishEvent(getInboxChannelName(payload.organizationId, staffId), 'priority_unbox', {
    type: 'priority_unbox',
    staffId,
    trackingNumber: payload.trackingNumber,
    receivingId: payload.receivingId,
    skus,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export type StaffMessagePayload = {
  organizationId: string;
  /** Recipient inbox channel (inbox:{recipientId}). */
  recipientId: number;
  messageId: number;
  senderId: number;
  senderName: string;
  body: string;
  kind: string;
  context?: Record<string, unknown> | null;
};

/**
 * Push a staff-to-staff message to the recipient's inbox channel — the live
 * half of the header clipboard "send to staff" flow (the row is also persisted
 * in staff_messages so it survives a reload). No-op on a bad recipient id.
 */
export async function publishStaffMessage(payload: StaffMessagePayload) {
  const recipientId = Number(payload.recipientId);
  if (!Number.isFinite(recipientId) || recipientId <= 0) return;

  await publishEvent(getInboxChannelName(payload.organizationId, recipientId), 'staff_message', {
    type: 'staff_message',
    recipientId,
    messageId: payload.messageId,
    senderId: payload.senderId,
    senderName: payload.senderName,
    body: payload.body,
    kind: payload.kind,
    context: payload.context ?? null,
    timestamp: formatPSTTimestamp(),
  });
}

export type WarrantyClaimNotificationPayload = {
  organizationId: string;
  /** Recipient staff inbox channels to push to. */
  staffIds: number[];
  claimId: number;
  claimNumber: string;
  /** New status after the transition. */
  status: string;
  /** Lifecycle event key: submitted | approved | denied | repaired | in_repair | closed | expired | repair_logged. */
  event: string;
  /** Display label (product / serial / claim #). */
  title?: string | null;
  actorStaffId?: number | null;
  source: string;
};

/**
 * Push a warranty-claim status change to each recipient's inbox channel. Fired
 * when a claim a staff member logged moves through its lifecycle (approved,
 * denied, repaired, closed, expired…). No-op when there are no recipients.
 */
export async function publishWarrantyClaimNotification(payload: WarrantyClaimNotificationPayload) {
  const recipients = Array.from(
    new Set((payload.staffIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
  );
  if (recipients.length === 0) return;

  const data = {
    type: 'warranty_claim' as const,
    claimId: payload.claimId,
    claimNumber: payload.claimNumber,
    status: payload.status,
    event: payload.event,
    title: payload.title ?? null,
    actorStaffId: payload.actorStaffId ?? null,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  };

  await Promise.all(
    recipients.map((staffId) =>
      publishEvent(getInboxChannelName(payload.organizationId, staffId), 'warranty_claim', { ...data, staffId }),
    ),
  );
}

/**
 * Tech-station inbox nudges — fan out a lightweight "refresh your queue" event
 * to every staffer whose primary station is TECH. The bell derives its actual
 * contents live from GET /api/inbox/tech-queue; these events just tell the
 * client to refetch (derive-live model). Best-effort + no-op with no recipients.
 */
type TechInboxPayload = {
  organizationId: string;
  receivingId: number | null;
  trackingNumber?: string | null;
  source: string;
};

async function publishTechInbox(eventName: 'return_pending_test' | 'order_ready_ship', payload: TechInboxPayload) {
  const recipients = await getPrimaryTechStaffIds(payload.organizationId);
  if (recipients.length === 0) return;
  const data = {
    type: eventName,
    receivingId: payload.receivingId,
    trackingNumber: payload.trackingNumber ?? null,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  };
  await Promise.all(
    recipients.map((staffId) =>
      publishEvent(getInboxChannelName(payload.organizationId, staffId), eventName, { ...data, staffId }),
    ),
  );
}

/** Unboxed return that still needs testing — nudge the tech station to refetch. */
export async function publishReturnPendingTest(payload: TechInboxPayload) {
  await publishTechInbox('return_pending_test', payload);
}

/** Unboxed priority carton whose order is ready to ship — nudge the tech station. */
export async function publishOrderReadyShip(payload: TechInboxPayload) {
  await publishTechInbox('order_ready_ship', payload);
}

export async function publishAiAssistantMessage(payload: AiAssistantPayload) {
  const channel = payload.channel || getAiAssistSessionChannelName(payload.organizationId, payload.sessionId);
  await publishEvent(channel, 'ai.assistant.reply', {
    type: 'ai.assistant.reply',
    sessionId: payload.sessionId,
    prompt: payload.prompt,
    answer: payload.answer,
    model: payload.model,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishStaffScheduleChanged(payload: StaffScheduleChangedPayload) {
  await publishEvent(getStaffChannelName(payload.organizationId), 'staff.schedule.changed', {
    type: 'staff.schedule.changed',
    action: payload.action,
    source: payload.source,
    changed: payload.changed,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishTechLogChanged(payload: TechLogChangedPayload) {
  await publishEvent(getStationChannelName(payload.organizationId), 'tech-log.changed', {
    type: 'tech-log.changed',
    techId: payload.techId,
    action: payload.action,
    rowId: payload.rowId,
    row: payload.row,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishPackerLogChanged(payload: PackerLogChangedPayload) {
  await publishEvent(getStationChannelName(payload.organizationId), 'packer-log.changed', {
    type: 'packer-log.changed',
    packerId: payload.packerId,
    action: payload.action,
    packerLogId: payload.packerLogId,
    row: payload.row,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

// ─── Packer mobile hand-off ───────────────────────────────────────────────
// Fired when a desktop scan creates a fresh packer_log row. The paired phone
// (subscribed to packer:{staffId}) lands on the confirm step so the packer
// can answer "Ready to pack?" and proceed to the photo camera.

export interface PackerScanReadyPayload {
  organizationId: string;
  staffId: number;
  packerLogId: number | null;
  variant: 'order' | 'fba' | 'exception';
  scannedValue: string;
  trackingType: string | null;
  order: {
    orderId: string;
    productTitle: string;
    qty: number;
    condition: string;
    tracking: string;
    sku?: string | null;
    itemNumber?: string | null;
    shipByDate?: string | null;
  } | null;
  fba: {
    fnsku: string;
    productTitle: string;
    shipmentRef: string | null;
    plannedQty: number;
    combinedPackScannedQty: number;
    isNew: boolean;
  } | null;
  source: string;
}

export async function publishPackerScanReady(payload: PackerScanReadyPayload) {
  await publishEvent(getPackerBridgeChannelName(payload.organizationId, payload.staffId), 'scan_ready', {
    type: 'packer.scan_ready',
    staffId: payload.staffId,
    packerLogId: payload.packerLogId,
    variant: payload.variant,
    scannedValue: payload.scannedValue,
    trackingType: payload.trackingType,
    order: payload.order,
    fba: payload.fba,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

// ─── Phone → desktop scan-history feed ────────────────────────────────────
// Fired when a phone scans a receiving Data Matrix label (R-/L-/U-) on
// /m/scan. The signed-in staff's desktop (subscribed to scanlog:{staffId})
// refetches its phone-history popover so the scan shows up live. This channel
// is READ-ONLY history — it NEVER writes receiving_* and is strictly disjoint
// from the receiving-station `phone:{staffId}` bridge.

export interface ScanLoggedPayload {
  organizationId: string;
  staffId: number;
  rawValue: string;
  kind: string;
  /** Mobile route the scan resolved to, e.g. /m/r/123, /m/l/45, /m/u/7. */
  routedTo: string;
}

export async function publishScanLog(payload: ScanLoggedPayload) {
  const staffId = Number(payload.staffId);
  if (!Number.isFinite(staffId) || staffId <= 0) return;

  await publishEvent(getScanLogChannelName(payload.organizationId, staffId), 'scan_logged', {
    type: 'scan.logged',
    staffId,
    rawValue: payload.rawValue,
    kind: payload.kind,
    routedTo: payload.routedTo,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishReceivingLogChanged(payload: ReceivingLogChangedPayload) {
  await publishEvent(getStationChannelName(payload.organizationId), 'receiving-log.changed', {
    type: 'receiving-log.changed',
    action: payload.action,
    rowId: payload.rowId,
    row: payload.row,
    source: payload.source,
    ...(payload.zohoReceive ? { zohoReceive: payload.zohoReceive } : {}),
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishReceivingPhotoChanged(payload: ReceivingPhotoChangedPayload) {
  const receivingId = Number(payload.receivingId);
  if (!Number.isFinite(receivingId) || receivingId <= 0) return;

  const receivingLineId =
    payload.receivingLineId == null ? null : Number(payload.receivingLineId);
  const photoId = payload.photoId == null ? null : Number(payload.photoId);
  const totalPhotoCount =
    payload.totalPhotoCount == null ? null : Number(payload.totalPhotoCount);

  await publishEvent(getStationChannelName(payload.organizationId), 'receiving-photo.changed', {
    type: 'receiving-photo.changed',
    action: payload.action,
    receiving_id: receivingId,
    receiving_line_id:
      receivingLineId != null && Number.isFinite(receivingLineId) ? receivingLineId : null,
    photo_id: photoId != null && Number.isFinite(photoId) ? photoId : null,
    total_photo_count:
      totalPhotoCount != null && Number.isFinite(totalPhotoCount) ? totalPhotoCount : null,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

/**
 * Packer photo insert/delete — the packing mirror of
 * {@link publishReceivingPhotoChanged}. Published on the shared station channel
 * so the desktop photo library and the mobile packing feed live-refresh the
 * moment a packer's phone commits a GCS upload. Keyed by `packer_log_id`; the
 * `order_id` lets subscribers scope to one order without a re-fetch.
 */
export async function publishPackerPhotoChanged(payload: PackerPhotoChangedPayload) {
  const packerLogId = Number(payload.packerLogId);
  if (!Number.isFinite(packerLogId) || packerLogId <= 0) return;

  const photoId = payload.photoId == null ? null : Number(payload.photoId);
  const totalPhotoCount =
    payload.totalPhotoCount == null ? null : Number(payload.totalPhotoCount);

  await publishEvent(getStationChannelName(payload.organizationId), 'packer-photo.changed', {
    type: 'packer-photo.changed',
    action: payload.action,
    packer_log_id: packerLogId,
    order_id: payload.orderId ?? null,
    photo_id: photoId != null && Number.isFinite(photoId) ? photoId : null,
    total_photo_count:
      totalPhotoCount != null && Number.isFinite(totalPhotoCount) ? totalPhotoCount : null,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

type ShipmentChangedPayload = {
  organizationId: string;
  shipmentId: number;
  trackingNumber?: string | null;
  source: string;
};

/**
 * Fired whenever a shipment's carrier status changes (webhook push or poll),
 * independent of any order linkage — this is what makes the receiving/incoming
 * carrier panels live-update like the carrier's own website. Order-linked
 * shipments separately get an `order.changed` event for the dashboard views.
 */
export async function publishShipmentChanged(payload: ShipmentChangedPayload) {
  await publishEvent(getStationChannelName(payload.organizationId), 'shipment.changed', {
    type: 'shipment.changed',
    shipmentId: payload.shipmentId,
    trackingNumber: payload.trackingNumber ?? null,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

// ─── FBA Events ──────────────────────────────────────────────────────────────

type FbaItemChangedPayload = {
  organizationId: string;
  action: 'scan' | 'ready' | 'verify' | 'label-bind' | 'shipped' | 'reassign' | 'update' | 'delete';
  shipmentId: number;
  itemId?: number;
  fnsku?: string;
  source: string;
};

type FbaShipmentChangedPayload = {
  organizationId: string;
  action: 'created' | 'updated' | 'closed' | 'deleted' | 'mark-shipped' | 'tracking-linked' | 'tracking-unlinked' | 'duplicated' | 'items-added';
  shipmentId: number;
  source: string;
};

type FbaCatalogChangedPayload = {
  organizationId: string;
  action: 'created' | 'updated' | 'bulk-uploaded';
  fnsku?: string;
  count?: number;
  source: string;
};

export async function publishFbaItemChanged(payload: FbaItemChangedPayload) {
  await publishEvent(getFbaChannelName(payload.organizationId), 'fba.item.changed', {
    type: 'fba.item.changed',
    action: payload.action,
    shipmentId: payload.shipmentId,
    itemId: payload.itemId,
    fnsku: payload.fnsku,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishFbaShipmentChanged(payload: FbaShipmentChangedPayload) {
  await publishEvent(getFbaChannelName(payload.organizationId), 'fba.shipment.changed', {
    type: 'fba.shipment.changed',
    action: payload.action,
    shipmentId: payload.shipmentId,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishFbaCatalogChanged(payload: FbaCatalogChangedPayload) {
  await publishEvent(getFbaChannelName(payload.organizationId), 'fba.catalog.changed', {
    type: 'fba.catalog.changed',
    action: payload.action,
    fnsku: payload.fnsku,
    count: payload.count,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

// ─── Activity Stream ─────────────────────────────────────────────────────────

type ActivityLoggedPayload = {
  organizationId: string;
  id: number;
  station: string;
  activityType: string;
  staffId: number | null;
  staffName?: string | null;
  scanRef?: string | null;
  fnsku?: string | null;
  source: string;
  // Stock ledger events carry these — undefined for regular activity rows.
  delta?: number | null;
  dimension?: string | null;
  reason?: string | null;
};

export async function publishActivityLogged(payload: ActivityLoggedPayload) {
  // Update station channel for legacy feed
  await publishEvent(getStationChannelName(payload.organizationId), 'activity.logged', {
    type: 'activity.logged',
    id: payload.id,
    station: payload.station,
    activityType: payload.activityType,
    staffId: payload.staffId,
    staffName: payload.staffName,
    scanRef: payload.scanRef,
    fnsku: payload.fnsku,
    source: payload.source,
    delta: payload.delta ?? null,
    dimension: payload.dimension ?? null,
    reason: payload.reason ?? null,
    timestamp: formatPSTTimestamp(),
  });

  // Update all-in-one dashboard feed
  await publishDashboardUpdate({
    organizationId: payload.organizationId,
    type: 'activity_event',
    data: {
      id: String(payload.id),
      timestamp: formatPSTTimestamp(),
      type: payload.activityType,
      source: payload.station,
      summary: payload.scanRef || payload.fnsku || 'Activity logged',
      staff_id: payload.staffId
    }
  });
}

// ─── Stock Ledger Event Helper ───────────────────────────────────────────────

export type StockLedgerEventInput = {
  organizationId: string;
  /** Row id from sku_stock_ledger (positive int). Negated on the wire so feed ids never collide with station_activity_logs ids. */
  ledgerId: number;
  sku: string;
  delta: number;
  reason: string;       // PICKED | PACKED | SHIPPED | RECEIVED | RETURNED | ADJUSTMENT | SET | CYCLE_COUNT | DAMAGED | SOLD
  dimension: string;    // WAREHOUSE | BOXED
  staffId?: number | null;
  staffName?: string | null;
  source: string;
};

function reasonToStation(reason: string): string {
  switch (reason) {
    case 'PICKED':   return 'TECH';
    case 'PACKED':
    case 'SHIPPED':  return 'PACK';
    case 'RECEIVED':
    case 'RETURNED': return 'RECEIVING';
    default:         return 'ADMIN';
  }
}

/**
 * Fire the live-feed event for a sku_stock_ledger row. Call immediately
 * after each ledger INSERT so ActivityFeed.tsx can append without waiting
 * for its 120s poll.
 */
export async function publishStockLedgerEvent(input: StockLedgerEventInput) {
  await publishActivityLogged({
    organizationId: input.organizationId,
    id: -Math.abs(input.ledgerId),
    station: reasonToStation(input.reason),
    activityType: `STOCK_DELTA_${input.reason}`,
    staffId: input.staffId ?? null,
    staffName: input.staffName ?? null,
    scanRef: input.sku,
    source: input.source,
    delta: input.delta,
    dimension: input.dimension,
    reason: input.reason,
  });
}
