export const DEFAULT_ORDERS_CHANNEL = 'orders:changes';
export const DEFAULT_REPAIRS_CHANNEL = 'repair:changes';

export const getOrdersChannelName = () =>
  process.env.ABLY_CHANNEL_ORDERS_CHANGES ||
  process.env.NEXT_PUBLIC_ABLY_CHANNEL_ORDERS_CHANGES ||
  DEFAULT_ORDERS_CHANNEL;

export const getRepairsChannelName = () =>
  process.env.ABLY_CHANNEL_REPAIR_CHANGES ||
  process.env.NEXT_PUBLIC_ABLY_CHANNEL_REPAIR_CHANGES ||
  DEFAULT_REPAIRS_CHANNEL;
