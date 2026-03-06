'use client';

import { useEffect, useRef } from 'react';
import { useAblyClient } from '@/contexts/AblyContext';

/**
 * Subscribes to a single Ably channel + event via the shared client.
 * Uses a stable handler ref so the subscription is never torn down and
 * recreated on every render — only when channel/event/enabled changes.
 */
export function useAblyChannel(
  channelName: string,
  eventName: string,
  handler: (message: any) => void,
  enabled = true,
) {
  const { getClient } = useAblyClient();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let channel: any = null;
    const stableHandler = (msg: any) => handlerRef.current(msg);

    getClient().then((client) => {
      if (disposed || !client) return;
      channel = client.channels.get(channelName);
      channel.subscribe(eventName, stableHandler);
    });

    return () => {
      disposed = true;
      try {
        channel?.unsubscribe(eventName, stableHandler);
      } catch {}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, eventName, enabled]);
}
