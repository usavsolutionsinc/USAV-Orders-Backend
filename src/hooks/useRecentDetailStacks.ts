'use client';

import { useSyncExternalStore } from 'react';
import {
  getDetailStacks,
  getDetailStacksServerSnapshot,
  subscribeDetailStacks,
  type DetailStackEntry,
} from '@/lib/detail-stacks/history-store';

/**
 * Reactive read of the recent-detail-stacks history (most-recent first). Any
 * component that renders it repaints when the URL tracker records a new open.
 */
export function useRecentDetailStacks(): DetailStackEntry[] {
  return useSyncExternalStore(subscribeDetailStacks, getDetailStacks, getDetailStacksServerSnapshot);
}
