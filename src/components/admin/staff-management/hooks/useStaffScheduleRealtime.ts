'use client';

/**
 * Realtime invalidation for the Staff Schedule tab: when any client edits the
 * schedule, the `staff.schedule.changed` event on the org's staff channel
 * refetches both the schedule and roster queries. Extracted from
 * StaffScheduleTab; behaviour is unchanged.
 */

import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getStaffChannelName, safeChannelName } from '@/lib/realtime/channels';
import { useAuth } from '@/contexts/AuthContext';

export function useStaffScheduleRealtime(): void {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const staffChannelName = safeChannelName(() => getStaffChannelName(orgId!));

  useAblyChannel(
    staffChannelName,
    'staff.schedule.changed',
    () => {
      queryClient.invalidateQueries({ queryKey: qk.staffSchedule.all });
      queryClient.invalidateQueries({ queryKey: qk.staff.all });
    },
    !!staffChannelName,
  );
}
