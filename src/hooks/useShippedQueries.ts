import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { ShippedRecord } from '@/lib/neon/shipped-queries';

/**
 * Fetch all shipped records
 */
export function useShipped(page = 1, limit = 50) {
  return useQuery({
    queryKey: ['shipped', page, limit],
    queryFn: async () => {
      const res = await fetch(`/api/shipped?page=${page}&limit=${limit}`);
      if (!res.ok) throw new Error('Failed to fetch shipped records');
      return res.json();
    },
    staleTime: 30000, // 30 seconds
    retry: 2,
  });
}

/**
 * Fetch single shipped record by ID
 */
export function useShippedRecord(id: number) {
  return useQuery({
    queryKey: ['shipped-record', id],
    queryFn: async () => {
      const res = await fetch(`/api/shipped/${id}`);
      if (!res.ok) throw new Error('Failed to fetch shipped record');
      return res.json();
    },
    enabled: !!id,
  });
}

/**
 * Update shipped status with optimistic updates
 */
export function useUpdateShippedStatus() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch('/api/shipped', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      return res.json();
    },
    onMutate: async ({ id, status }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['shipped'] });
      
      // Snapshot previous value
      const previous = queryClient.getQueryData(['shipped']);
      
      // Optimistically update
      queryClient.setQueryData(['shipped'], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          shipped: old.shipped?.map((s: ShippedRecord) =>
            s.id === id ? { ...s, status } : s
          ),
        };
      });
      
      return { previous };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(['shipped'], context.previous);
      }
      toast.error('Failed to update status');
      console.error('Status update error:', err);
    },
    onSuccess: () => {
      toast.success('Status updated successfully');
      queryClient.invalidateQueries({ queryKey: ['shipped'] });
    },
  });
}

/**
 * Update generic shipped field
 */
export function useUpdateShippedField() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, field, value }: { id: number; field: string; value: any }) => {
      const res = await fetch('/api/shipped', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, field, value }),
      });
      if (!res.ok) throw new Error('Failed to update field');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipped'] });
    },
    onError: (err) => {
      toast.error('Failed to update field');
      console.error('Field update error:', err);
    },
  });
}
