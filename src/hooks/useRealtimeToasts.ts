'use client';

import { useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useAblyChannel } from './useAblyChannel';
import {
  getOrdersChannelName,
  getRepairsChannelName,
  getStationChannelName,
  getFbaChannelName,
} from '@/lib/realtime/channels';

type ToastRole = 'tech' | 'packer' | 'admin' | 'receiving';

export function useRealtimeToasts(role: ToastRole, enabled = true) {
  const lastRef = useRef<Record<string, number>>({});

  const throttled = useCallback((key: string, fn: () => void, ms = 5000) => {
    const now = Date.now();
    if (now - (lastRef.current[key] ?? 0) < ms) return;
    lastRef.current[key] = now;
    fn();
  }, []);

  // Order tested → packer sees "ready to pack"
  useAblyChannel(getOrdersChannelName(), 'order.tested', () => {
    if (role === 'packer' || role === 'admin') {
      throttled('tested', () => toast.success('Order tested — ready to pack'));
    }
  }, enabled);

  // Packer completed → tech sees "order packed"
  useAblyChannel(getStationChannelName(), 'packer-log.changed', (msg: any) => {
    if ((role === 'tech' || role === 'admin') && msg?.data?.action === 'insert') {
      throttled('packed', () => toast('Order packed and shipped'));
    }
  }, enabled);

  // New repair intake → tech sees notification
  useAblyChannel(getRepairsChannelName(), 'repair.changed', () => {
    if (role === 'tech' || role === 'admin') {
      throttled('repair', () => toast('New repair intake received'));
    }
  }, enabled);

  // Receiving entry → receiving station sees notification
  useAblyChannel(getStationChannelName(), 'receiving-log.changed', () => {
    if (role === 'receiving' || role === 'admin') {
      throttled('receiving', () => toast('New receiving entry scanned'));
    }
  }, enabled);

  // FBA scan → admin sees notification
  useAblyChannel(getFbaChannelName(), 'fba.item.changed', (msg: any) => {
    if (role === 'admin' && msg?.data?.action === 'scan') {
      throttled('fba-scan', () => toast('FBA item scanned'));
    }
  }, enabled);
}
