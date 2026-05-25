'use client';

import { useQuickAccess } from '@/lib/quick-access/use-quick-access';
import { useAuth } from '@/contexts/AuthContext';
import { QuickAccessButton } from './QuickAccessButton';

/**
 * Bottom-right Quick Access FAB wrapper. Single button — the activity
 * inbox lives inside the QuickAccess popover as an "Actions" row that
 * opens its own secondary popover (mirrors the Phone history pattern).
 *
 * On mobile, this is often hidden in favor of header integration or
 * contextual triggers.
 */
export function QuickAccessFab() {
  const { settings } = useQuickAccess();
  const { user: authUser } = useAuth();

  if (!settings.enabled) return null;
  if (!authUser) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40">
      <QuickAccessButton
        placement="up"
        buttonClassName="!h-12 !w-12 !rounded-full shadow-lg ring-2 ring-white"
      />
    </div>
  );
}

export default QuickAccessFab;
