import { cache } from 'react';
import { getCurrentUser } from './current-user';
import { touchSession } from './session';
import type { AuthSessionUser } from '@/contexts/AuthContext';

export const getInitialAuthUser = cache(async (): Promise<AuthSessionUser | null> => {
  const current = await getCurrentUser();
  if (!current || current.role === 'unknown') return null;

  void touchSession(current.session.sid);

  return {
    staffId: current.staffId,
    name: current.name,
    role: current.role,
    permissions: Array.from(current.permissions),
    mobileDisplayConfig: current.mobileDisplayConfig,
    session: {
      sid: current.session.sid,
      deviceKind: current.session.deviceKind,
      deviceLabel: current.session.deviceLabel,
      expiresAt: current.session.expiresAt.toISOString(),
    },
  };
});
