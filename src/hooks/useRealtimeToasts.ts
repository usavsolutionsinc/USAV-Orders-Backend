'use client';

type ToastRole = 'tech' | 'packer' | 'admin' | 'receiving';

/**
 * Realtime toast notifications were intentionally disabled.
 * Ably event visibility now goes through server-side station_activity_logs.
 */
export function useRealtimeToasts(role: ToastRole, enabled = true) {
  void role;
  void enabled;
}
