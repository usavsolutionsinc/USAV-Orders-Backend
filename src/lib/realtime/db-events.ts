import Ably from 'ably';
import { getDbRowChannelName, getDbTableChannelName } from '@/lib/realtime/channels';

export type RealtimeDbEvent = {
  id: string;
  schema: string;
  table: string;
  pk: Record<string, unknown>;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  version?: number | null;
  actorStaffId?: number | null;
  payload?: Record<string, unknown> | null;
  needsRefetch?: boolean;
  createdAt?: string;
};

let ablyRestClient: Ably.Rest | null = null;

function getAblyRestClient() {
  const key = process.env.ABLY_API_KEY;
  if (!key) return null;

  if (!ablyRestClient) {
    ablyRestClient = new Ably.Rest({ key });
  }
  return ablyRestClient;
}

function getPrimaryKeyId(pk: Record<string, unknown>): string | number | null {
  const id = pk?.id;
  if (typeof id === 'string' || typeof id === 'number') return id;
  return null;
}

export async function publishDbEvent(event: RealtimeDbEvent) {
  const client = getAblyRestClient();
  if (!client) return;

  const rowId = getPrimaryKeyId(event.pk);
  const basePayload = {
    type: `db.row.${event.op.toLowerCase()}`,
    eventId: event.id,
    schema: event.schema,
    table: event.table,
    pk: event.pk,
    version: event.version ?? null,
    actorStaffId: event.actorStaffId ?? null,
    row: event.payload ?? null,
    needsRefetch: !!event.needsRefetch,
    timestamp: event.createdAt ?? new Date().toISOString(),
  };

  await client.channels.get(getDbTableChannelName(event.schema, event.table)).publish('db.row.changed', basePayload);

  if (rowId != null) {
    await client.channels.get(getDbRowChannelName(event.schema, event.table, rowId)).publish('db.row.changed', basePayload);
  }
}
