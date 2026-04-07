export const DEFAULT_ORDERS_CHANNEL = 'orders:changes';
export const DEFAULT_REPAIRS_CHANNEL = 'repair:changes';
export const DEFAULT_AI_ASSIST_CHANNEL = 'ai:assist';
export const DEFAULT_STATION_CHANNEL = 'station:changes';
export const DEFAULT_STAFF_CHANNEL = 'staff:changes';
export const DEFAULT_DB_CHANNEL_PREFIX = 'db';

function normalizeChannelName(value: string | undefined | null, fallback: string): string {
  const raw = String(value || '');
  const trimmed = raw.trim();
  // Strip control chars defensively; Ably rejects names with embedded newlines.
  const sanitized = trimmed.replace(/[\u0000-\u001F\u007F]/g, '');
  return sanitized || fallback;
}

export const getOrdersChannelName = () =>
  normalizeChannelName(
    process.env.ABLY_CHANNEL_ORDERS_CHANGES ||
      process.env.NEXT_PUBLIC_ABLY_CHANNEL_ORDERS_CHANGES,
    DEFAULT_ORDERS_CHANNEL
  );

export const getRepairsChannelName = () =>
  normalizeChannelName(
    process.env.ABLY_CHANNEL_REPAIR_CHANGES ||
      process.env.NEXT_PUBLIC_ABLY_CHANNEL_REPAIR_CHANGES,
    DEFAULT_REPAIRS_CHANNEL
  );

export const getAiAssistChannelName = () =>
  normalizeChannelName(
    process.env.ABLY_CHANNEL_AI_ASSIST ||
      process.env.NEXT_PUBLIC_ABLY_CHANNEL_AI_ASSIST,
    DEFAULT_AI_ASSIST_CHANNEL
  );

export const getAiAssistSessionChannelName = (sessionId: string) =>
  `${getAiAssistChannelName()}:${normalizeChannelName(sessionId, 'session')}`;

/** Single channel for all station-level row changes (tech logs, packer logs, receiving). */
export const getStationChannelName = () =>
  normalizeChannelName(
    process.env.ABLY_CHANNEL_STATION_CHANGES ||
      process.env.NEXT_PUBLIC_ABLY_CHANNEL_STATION_CHANGES,
    DEFAULT_STATION_CHANNEL
  );

export const getStaffChannelName = () =>
  normalizeChannelName(
    process.env.ABLY_CHANNEL_STAFF_CHANGES ||
      process.env.NEXT_PUBLIC_ABLY_CHANNEL_STAFF_CHANGES,
    DEFAULT_STAFF_CHANNEL
  );

export const DEFAULT_FBA_CHANNEL = 'fba:changes';
export const DEFAULT_DASHBOARD_CHANNEL = 'dashboard:operations';

export const getFbaChannelName = () =>
  normalizeChannelName(
    process.env.ABLY_CHANNEL_FBA_CHANGES ||
      process.env.NEXT_PUBLIC_ABLY_CHANNEL_FBA_CHANGES,
    DEFAULT_FBA_CHANNEL
  );

export const getDashboardChannelName = () =>
  normalizeChannelName(
    process.env.ABLY_CHANNEL_DASHBOARD ||
      process.env.NEXT_PUBLIC_ABLY_CHANNEL_DASHBOARD,
    DEFAULT_DASHBOARD_CHANNEL
  );

export const DEFAULT_WALKIN_CHANNEL = 'walkin:changes';

export const getWalkInChannelName = () =>
  normalizeChannelName(
    process.env.ABLY_CHANNEL_WALKIN_CHANGES ||
      process.env.NEXT_PUBLIC_ABLY_CHANNEL_WALKIN_CHANGES,
    DEFAULT_WALKIN_CHANNEL
  );

export const getDbChannelPrefix = () =>
  normalizeChannelName(
    process.env.ABLY_CHANNEL_DB_PREFIX ||
      process.env.NEXT_PUBLIC_ABLY_CHANNEL_DB_PREFIX,
    DEFAULT_DB_CHANNEL_PREFIX
  );

export const getDbTableChannelName = (schema: string, table: string) =>
  `${getDbChannelPrefix()}:${schema}:${table}`;

export const getDbRowChannelName = (schema: string, table: string, rowId: string | number) =>
  `${getDbTableChannelName(schema, table)}:${rowId}`;
