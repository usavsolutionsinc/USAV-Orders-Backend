import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { RSRecord } from '@/lib/neon/repair-service-queries';
import { useActivityInboxOptional } from '@/contexts/ActivityInboxContext';

function mapRepairListCaches(
  old: unknown,
  repairId: number,
  nextStatus: string,
): unknown {
  if (!old) return old;
  if (Array.isArray(old)) {
    return (old as RSRecord[]).map((r) =>
      r.id === repairId ? { ...r, status: nextStatus } : r,
    );
  }
  if (typeof old !== 'object') return old;
  const o = old as { repairs?: RSRecord[]; rows?: RSRecord[] };
  const next: typeof o & Record<string, unknown> = { ...o };
  if (Array.isArray(o.repairs)) {
    next.repairs = o.repairs.map((r) =>
      r.id === repairId ? { ...r, status: nextStatus } : r,
    );
  }
  if (Array.isArray(o.rows)) {
    next.rows = o.rows.map((r) =>
      r.id === repairId ? { ...r, status: nextStatus } : r,
    );
  }
  return next;
}

function readRepairPreviousStatus(
  queryClient: QueryClient,
  repairId: number,
): { found: boolean; status: string } {
  const single = queryClient.getQueryData<RSRecord | Record<string, unknown>>([
    'repair',
    repairId,
  ]);
  if (single && typeof (single as RSRecord).id === 'number') {
    const s = (single as RSRecord).status;
    return {
      found: true,
      status: typeof s === 'string' ? s : '',
    };
  }

  const bundles = queryClient.getQueriesData<unknown>({
    queryKey: ['repairs'],
  });

  for (const [, data] of bundles) {
    if (!data) continue;
    if (Array.isArray(data)) {
      const row = (data as RSRecord[]).find((r) => r.id === repairId);
      if (row) {
        const s = row.status;
        return { found: true, status: typeof s === 'string' ? s : '' };
      }
      continue;
    }
    if (typeof data !== 'object' || data === null) continue;
    const o = data as { repairs?: RSRecord[]; rows?: RSRecord[] };
    const list = Array.isArray(o.repairs)
      ? o.repairs
      : Array.isArray(o.rows)
        ? o.rows
        : null;
    if (!list) continue;
    const row = list.find((r) => r.id === repairId);
    if (row) {
      const s = row.status;
      return { found: true, status: typeof s === 'string' ? s : '' };
    }
  }

  return { found: false, status: '' };
}

/**
 * Fetch all repairs
 */
export function useRepairs(page = 1, limit = 50) {
  return useQuery({
    queryKey: ['repairs', page, limit],
    queryFn: async () => {
      const res = await fetch(`/api/repair-service?page=${page}&limit=${limit}`);
      if (!res.ok) throw new Error('Failed to fetch repairs');
      return res.json();
    },
    staleTime: 30000, // 30 seconds
    retry: 2,
  });
}

/**
 * Fetch single repair by ID
 */
export function useRepair(id: number) {
  return useQuery({
    queryKey: ['repair', id],
    queryFn: async () => {
      const res = await fetch(`/api/repair-service/${id}`);
      if (!res.ok) throw new Error('Failed to fetch repair');
      return res.json();
    },
    enabled: !!id,
  });
}

/**
 * Update repair status with optimistic updates
 */
export function useUpdateRepairStatus() {
  const queryClient = useQueryClient();
  const inbox = useActivityInboxOptional();

  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch('/api/repair-service', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      return res.json();
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['repairs'] });
      await queryClient.cancelQueries({ queryKey: ['repair', id] });

      const { found, status: prevStatus } = readRepairPreviousStatus(
        queryClient,
        id,
      );

      const listSnapshots = queryClient.getQueriesData({ queryKey: ['repairs'] });
      const detailSnapshot = queryClient.getQueryData<RSRecord | undefined>([
        'repair',
        id,
      ]);

      queryClient.setQueriesData<unknown>(
        { queryKey: ['repairs'] },
        (old: unknown) => mapRepairListCaches(old, id, status),
      );

      queryClient.setQueryData<RSRecord>(['repair', id], (old: RSRecord | undefined) =>
        old?.id === id ? { ...old, status } : old,
      );

      return {
        listSnapshots,
        detailSnapshot,
        previousStatus: found ? prevStatus : null,
      };
    },
    onError: (err, variables, context) => {
      if (context?.listSnapshots) {
        for (const [queryKey, data] of context.listSnapshots) {
          queryClient.setQueryData(queryKey, data);
        }
      }
      if (variables?.id != null) {
        queryClient.setQueryData(
          ['repair', variables.id],
          context?.detailSnapshot,
        );
      }
      toast.error('Failed to update status');
      console.error('Status update error:', err);
    },
    onSuccess: (_data, variables, context) => {
      toast.success('Status updated successfully');
      const prev = context?.previousStatus;
      if (
        inbox &&
        prev !== null &&
        prev !== variables.status
      ) {
        inbox.pushRepairStatusChange({
          repairId: variables.id,
          previousStatus: prev,
          nextStatus: variables.status,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['repairs'] });
      void queryClient.invalidateQueries({ queryKey: ['repair', variables.id] });
    },
  });
}

/**
 * Update repair notes
 */
export function useUpdateRepairNotes() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) => {
      const res = await fetch('/api/repair-service', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, notes }),
      });
      if (!res.ok) throw new Error('Failed to update notes');
      return res.json();
    },
    onSuccess: () => {
      toast.success('Notes saved');
      queryClient.invalidateQueries({ queryKey: ['repairs'] });
    },
    onError: (err) => {
      toast.error('Failed to save notes');
      console.error('Notes update error:', err);
    },
  });
}

/**
 * Update generic repair field
 */
export function useUpdateRepairField() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, field, value }: { id: number; field: string; value: any }) => {
      const res = await fetch('/api/repair-service', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, field, value }),
      });
      if (!res.ok) throw new Error('Failed to update field');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repairs'] });
    },
    onError: (err) => {
      toast.error('Failed to update field');
      console.error('Field update error:', err);
    },
  });
}
