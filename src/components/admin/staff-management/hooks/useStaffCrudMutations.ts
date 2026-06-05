import { useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import type { StaffRole, StaffUpdatePayload } from '../constants';

interface UseStaffCrudMutationsArgs {
  /** Called after a staff record is created (e.g. to close the add form). */
  onAfterCreate?: () => void;
  /** Called after a staff record is updated or deleted (e.g. to close the editor). */
  onAfterMutateMember?: () => void;
}

/**
 * The canonical create / update / delete mutations for staff records. Each
 * invalidates the staff + schedule caches; form-closing side effects are left
 * to the caller via the optional callbacks.
 */
export function useStaffCrudMutations({ onAfterCreate, onAfterMutateMember }: UseStaffCrudMutationsArgs = {}) {
  const queryClient = useQueryClient();

  const createStaffMutation = useMutation({
    mutationFn: async (data: { name: string; role: StaffRole; employee_id: string; active: boolean }) => {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create staff');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.staff.all });
      queryClient.invalidateQueries({ queryKey: qk.staffSchedule.all });
      onAfterCreate?.();
    },
  });

  const updateStaffMutation = useMutation({
    mutationFn: async (data: StaffUpdatePayload) => {
      const res = await fetch('/api/staff', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update staff');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.staff.all });
      queryClient.invalidateQueries({ queryKey: qk.staffSchedule.all });
      onAfterMutateMember?.();
    },
  });

  const deleteStaffMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/staff?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete staff');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.staff.all });
      queryClient.invalidateQueries({ queryKey: qk.staffSchedule.all });
      onAfterMutateMember?.();
    },
  });

  return { createStaffMutation, updateStaffMutation, deleteStaffMutation };
}
