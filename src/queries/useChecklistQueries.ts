import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface Tag {
    id: number;
    name: string;
    color: string;
}

export interface TaskTemplate {
    id: number;
    title: string;
    description: string | null;
    role: string;
    station_id?: string;
    order_number: string | null;
    tracking_number: string | null;
    tags: Tag[];
    created_at: string;
}

export interface TaskInstance {
    template_id: number;
    status: 'pending' | 'in_progress' | 'completed';
    started_at: string | null;
    completed_at: string | null;
    duration_minutes: number | null;
    notes: string | null;
    task_date: string;
}

export interface ChecklistItem extends TaskTemplate {
    instance?: TaskInstance;
}

export interface CompletedTask {
    id: number;
    template_id: number;
    task_title: string;
    task_description: string | null;
    order_number: string | null;
    tracking_number: string | null;
    completed_at: string;
    completed_by: string | null;
    duration_minutes: number | null;
    notes: string | null;
}

export interface ChecklistQueriesOptions {
    role: 'technician' | 'packer';
    stationId: string;
    staffId: number;
    staffName: string;
}

/**
 * Custom hook to manage all checklist-related queries and mutations
 */
export function useChecklistQueries({
    role,
    stationId,
    staffId,
    staffName,
}: ChecklistQueriesOptions) {
    const queryClient = useQueryClient();

    // Fetch active checklist items
    const checklistQuery = useQuery<ChecklistItem[]>({
        queryKey: ['checklist', stationId, staffId],
        queryFn: async () => {
            const res = await fetch(`/api/checklist?stationId=${stationId}&staffId=${staffId}`);
            if (!res.ok) throw new Error('Failed to fetch checklist');
            const data = await res.json();
            return data.filter((item: ChecklistItem) => item.instance?.status !== 'completed');
        },
    });

    // Fetch completed tasks
    const completedTasksQuery = useQuery<CompletedTask[]>({
        queryKey: ['completed-tasks', stationId, staffId],
        queryFn: async () => {
            const res = await fetch(`/api/checklist/completed?stationId=${stationId}&staffId=${staffId}`);
            if (!res.ok) return [];
            return res.json();
        },
    });

    // Toggle task status mutation
    const toggleMutation = useMutation({
        mutationFn: async ({ templateId, status, notes }: { templateId: number; status: string; notes?: string }) => {
            const res = await fetch('/api/checklist/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templateId, staffId, role, status, notes, stationId, staffName }),
            });
            if (!res.ok) throw new Error('Failed to update task');
            return res.json();
        },
        onMutate: async ({ templateId, status }) => {
            // Cancel outgoing refetches
            await queryClient.cancelQueries({ queryKey: ['checklist', stationId, staffId] });
            
            // Snapshot previous value
            const previousTasks = queryClient.getQueryData(['checklist', stationId, staffId]);
            
            // Optimistically update
            queryClient.setQueryData<ChecklistItem[]>(['checklist', stationId, staffId], (old = []) => {
                return old.map(item => 
                    item.id === templateId
                        ? {
                            ...item,
                            instance: {
                                ...item.instance,
                                template_id: templateId,
                                status: status as 'pending' | 'in_progress' | 'completed',
                                task_date: new Date().toISOString().split('T')[0],
                                started_at: item.instance?.started_at || null,
                                completed_at: status === 'completed' ? new Date().toISOString() : null,
                                duration_minutes: item.instance?.duration_minutes || null,
                                notes: item.instance?.notes || null,
                            }
                        }
                        : item
                );
            });
            
            return { previousTasks };
        },
        onError: (err, variables, context) => {
            // Rollback on error
            if (context?.previousTasks) {
                queryClient.setQueryData(['checklist', stationId, staffId], context.previousTasks);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklist', stationId, staffId] });
            queryClient.invalidateQueries({ queryKey: ['completed-tasks', stationId, staffId] });
        },
    });

    // Restore completed task mutation
    const restoreTaskMutation = useMutation({
        mutationFn: async (completedTaskId: number) => {
            const res = await fetch('/api/checklist/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ completedTaskId, staffId, role, stationId }),
            });
            if (!res.ok) throw new Error('Failed to restore task');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklist', stationId, staffId] });
            queryClient.invalidateQueries({ queryKey: ['completed-tasks', stationId, staffId] });
        },
    });

    // Update template mutation
    const updateTemplateMutation = useMutation({
        mutationFn: async (data: Partial<TaskTemplate> & { id: number }) => {
            const res = await fetch('/api/checklist/template', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...data, stationId }),
            });
            if (!res.ok) throw new Error('Failed to update template');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklist', stationId, staffId] });
        },
    });

    // Create template mutation
    const createTemplateMutation = useMutation({
        mutationFn: async (data: Omit<TaskTemplate, 'id' | 'created_at' | 'tags'>) => {
            const res = await fetch('/api/checklist/template', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...data, role, station_id: stationId }),
            });
            if (!res.ok) throw new Error('Failed to create template');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklist', stationId, staffId] });
        },
    });

    // Delete template mutation
    const deleteTemplateMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await fetch('/api/checklist/template', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, stationId }),
            });
            if (!res.ok) throw new Error('Failed to delete template');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklist', stationId, staffId] });
        },
    });

    return {
        // Queries
        items: checklistQuery.data || [],
        isLoading: checklistQuery.isLoading,
        completedTasks: completedTasksQuery.data || [],
        
        // Mutations
        toggleTask: toggleMutation.mutate,
        restoreTask: restoreTaskMutation.mutate,
        updateTemplate: updateTemplateMutation.mutate,
        createTemplate: createTemplateMutation.mutate,
        deleteTemplate: deleteTemplateMutation.mutate,
        
        // Loading states
        isToggling: toggleMutation.isPending,
        isRestoring: restoreTaskMutation.isPending,
        isUpdating: updateTemplateMutation.isPending,
        isCreating: createTemplateMutation.isPending,
        isDeleting: deleteTemplateMutation.isPending,
    };
}
