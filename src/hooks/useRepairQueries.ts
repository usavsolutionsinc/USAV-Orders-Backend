import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { RSRecord } from '@/lib/neon/rs-queries';

/**
 * Fetch all repairs
 */
export function useRepairs(page = 1, limit = 50) {
  return useQuery({
    queryKey: ['repairs', page, limit],
    queryFn: async () => {
      const res = await fetch(`/api/rs?page=${page}&limit=${limit}`);
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
      const res = await fetch(`/api/rs/${id}`);
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
  
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch('/api/rs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      return res.json();
    },
    onMutate: async ({ id, status }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['repairs'] });
      
      // Snapshot previous value
      const previous = queryClient.getQueryData(['repairs']);
      
      // Optimistically update
      queryClient.setQueryData(['repairs'], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          repairs: old.repairs?.map((r: RSRecord) =>
            r.id === id ? { ...r, status } : r
          ),
        };
      });
      
      return { previous };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(['repairs'], context.previous);
      }
      toast.error('Failed to update status');
      console.error('Status update error:', err);
    },
    onSuccess: () => {
      toast.success('Status updated successfully');
      queryClient.invalidateQueries({ queryKey: ['repairs'] });
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
      const res = await fetch('/api/rs', {
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
      const res = await fetch('/api/rs', {
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
