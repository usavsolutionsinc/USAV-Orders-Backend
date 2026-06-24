'use client';

import type { ReactNode } from 'react';
import { AblyProvider } from '@/contexts/AblyContext';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Mount realtime only for authenticated sessions. This prevents public pages
 * like /signin from creating an Ably client that immediately 401s on the token
 * endpoint and can linger in a failed state after navigation.
 */
export function AuthenticatedAblyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  if (!user) return <>{children}</>;
  return <AblyProvider>{children}</AblyProvider>;
}
