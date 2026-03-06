export const DEFAULT_ORDERS_CHANNEL = 'orders:changes';
export const DEFAULT_REPAIRS_CHANNEL = 'repair:changes';
export const DEFAULT_AI_ASSIST_CHANNEL = 'ai:assist';
export const DEFAULT_STATION_CHANNEL = 'station:changes';

export const getOrdersChannelName = () =>
  process.env.ABLY_CHANNEL_ORDERS_CHANGES ||
  process.env.NEXT_PUBLIC_ABLY_CHANNEL_ORDERS_CHANGES ||
  DEFAULT_ORDERS_CHANNEL;

export const getRepairsChannelName = () =>
  process.env.ABLY_CHANNEL_REPAIR_CHANGES ||
  process.env.NEXT_PUBLIC_ABLY_CHANNEL_REPAIR_CHANGES ||
  DEFAULT_REPAIRS_CHANNEL;

export const getAiAssistChannelName = () =>
  process.env.ABLY_CHANNEL_AI_ASSIST ||
  process.env.NEXT_PUBLIC_ABLY_CHANNEL_AI_ASSIST ||
  DEFAULT_AI_ASSIST_CHANNEL;

export const getAiAssistSessionChannelName = (sessionId: string) =>
  `${getAiAssistChannelName()}:${sessionId}`;

/** Single channel for all station-level row changes (tech logs, packer logs, receiving). */
export const getStationChannelName = () =>
  process.env.ABLY_CHANNEL_STATION_CHANGES ||
  process.env.NEXT_PUBLIC_ABLY_CHANNEL_STATION_CHANGES ||
  DEFAULT_STATION_CHANNEL;
