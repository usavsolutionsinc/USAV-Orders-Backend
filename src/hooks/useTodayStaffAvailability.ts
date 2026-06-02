'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getStaffChannelName } from '@/lib/realtime/channels';
import type { StaffMember } from '@/lib/staffCache';
import type { StaffAvailabilityMember, StaffAvailabilityResponse } from '@/lib/staff-availability';
import { staffHasRole } from '@/utils/staff';

interface StaffApiRow {
  id: number | string;
  name: string | null;
  role: string | null;
  role_keys?: unknown;
}

function rolesFrom(roleKeys: unknown, role: string): string[] {
  const keys = Array.isArray(roleKeys) ? roleKeys.map((k) => String(k)).filter(Boolean) : [];
  return keys.length > 0 ? keys : role ? [role] : [];
}

function normalizeStaff(raw: unknown): StaffMember[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => row as StaffApiRow)
    .map((row) => {
      const role = String(row.role || '');
      return {
        id: Number(row.id),
        name: String(row.name || ''),
        role,
        roles: rolesFrom(row.role_keys, role),
      };
    })
    .filter((row) => Number.isFinite(row.id) && row.id > 0);
}

async function fetchStaff(url: string): Promise<StaffMember[]> {
  const res = await fetch(url);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload?.details || payload?.error || `Failed request: ${url}`);
  }
  return normalizeStaff(await res.json());
}

function normalizeAvailabilityMembers(rows: StaffAvailabilityMember[] | undefined): StaffMember[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const role = String(row.role || '');
    return {
      id: Number(row.id),
      name: String(row.name || ''),
      role,
      roles: Array.isArray(row.roles) && row.roles.length > 0 ? row.roles.map(String) : role ? [role] : [],
    };
  });
}

async function fetchAvailability(): Promise<StaffAvailabilityResponse> {
  const res = await fetch('/api/staff/availability-today?includeInactive=true');
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload?.details || payload?.error || 'Failed to fetch staff availability');
  }
  return res.json();
}

export function useTodayStaffAvailability() {
  const queryClient = useQueryClient();
  const channelName = getStaffChannelName();

  useAblyChannel(channelName, 'staff.schedule.changed', () => {
    queryClient.invalidateQueries({ queryKey: qk.staff.availabilityToday });
    queryClient.invalidateQueries({ queryKey: qk.staffSchedule.all });
    queryClient.invalidateQueries({ queryKey: qk.staff.all });
  }, true);

  const availabilityQuery = useQuery<StaffAvailabilityResponse>({
    queryKey: qk.staff.availabilityToday,
    queryFn: fetchAvailability,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const activeQuery = useQuery<StaffMember[]>({
    queryKey: ['staff', 'active', 'today-availability'],
    queryFn: () => fetchStaff('/api/staff?active=true'),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const onQuery = useQuery<StaffMember[]>({
    queryKey: ['staff', 'present-today', 'today-availability'],
    queryFn: () => fetchStaff('/api/staff?active=true&presentToday=true'),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const hasAvailabilityData = Boolean(availabilityQuery.data);
  const all = hasAvailabilityData
    ? normalizeAvailabilityMembers([
      ...(availabilityQuery.data?.on || []),
      ...(availabilityQuery.data?.off || []),
    ])
    : (activeQuery.data ?? []);
  const on = hasAvailabilityData
    ? normalizeAvailabilityMembers(availabilityQuery.data?.on || [])
    : (onQuery.data ?? []);
  const inactive = hasAvailabilityData
    ? normalizeAvailabilityMembers(availabilityQuery.data?.inactive || [])
    : [];

  const onIdSet = useMemo(() => new Set(on.map((s) => Number(s.id))), [on]);
  const off = useMemo(() => all.filter((s) => !onIdSet.has(Number(s.id))), [all, onIdSet]);

  const techniciansOn = useMemo(() => on.filter((s) => staffHasRole(s, 'technician')), [on]);
  const packersOn = useMemo(() => on.filter((s) => staffHasRole(s, 'packer')), [on]);
  const techniciansOff = useMemo(() => off.filter((s) => staffHasRole(s, 'technician')), [off]);
  const packersOff = useMemo(() => off.filter((s) => staffHasRole(s, 'packer')), [off]);
  const techniciansInactive = useMemo(() => inactive.filter((s) => staffHasRole(s, 'technician')), [inactive]);
  const packersInactive = useMemo(() => inactive.filter((s) => staffHasRole(s, 'packer')), [inactive]);

  return {
    all,
    on,
    off,
    inactive,
    techniciansOn,
    packersOn,
    techniciansOff,
    packersOff,
    techniciansInactive,
    packersInactive,
    summary: availabilityQuery.data?.summary ?? null,
    isLoading: availabilityQuery.isLoading || activeQuery.isLoading || onQuery.isLoading,
    isFetching: availabilityQuery.isFetching || activeQuery.isFetching || onQuery.isFetching,
    error: availabilityQuery.error || activeQuery.error || onQuery.error || null,
    refetch: async () => {
      await Promise.all([availabilityQuery.refetch(), activeQuery.refetch(), onQuery.refetch()]);
    },
  };
}
