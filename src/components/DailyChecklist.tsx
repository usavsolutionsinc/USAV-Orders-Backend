'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface Task {
    id: number;
    templateId: number;
    title: string;
    description?: string;
    completed: boolean;
    completedAt?: string;
}

interface DailyChecklistProps {
    userId: string;
    role: 'packer' | 'technician';
}

const DailyChecklist: React.FC<DailyChecklistProps> = ({ userId, role }) => {
    const queryClient = useQueryClient();
    const [lastFetchDate, setLastFetchDate] = useState<string>('');

    // Fetch tasks
    const { data, isLoading, error } = useQuery<Task[]>({
        queryKey: ['daily-tasks', userId, role],
        queryFn: async () => {
            const res = await fetch(`/api/daily-tasks?userId=${userId}&role=${role}`);
            if (!res.ok) throw new Error('Failed to fetch tasks');
            const data = await res.json();
            setLastFetchDate(new Date().toISOString().split('T')[0]);
            return data.tasks || [];
        },
        refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
    });

    // Toggle task completion
    const toggleMutation = useMutation({
        mutationFn: async (taskId: number) => {
            const res = await fetch(`/api/daily-tasks/${taskId}`, {
                method: 'PATCH',
            });
            if (!res.ok) throw new Error('Failed to update task');
            return res.json();
        },
        onMutate: async (taskId) => {
            // Optimistic update
            await queryClient.cancelQueries({ queryKey: ['daily-tasks', userId, role] });
            const previousTasks = queryClient.getQueryData<Task[]>(['daily-tasks', userId, role]);
            
            queryClient.setQueryData<Task[]>(['daily-tasks', userId, role], (old) => {
                if (!old) return old;
                return old.map(task =>
                    task.id === taskId
                        ? { ...task, completed: !task.completed, completedAt: task.completed ? undefined : new Date().toISOString() }
                        : task
                );
            });

            return { previousTasks };
        },
        onError: (err, taskId, context) => {
            // Rollback on error
            if (context?.previousTasks) {
                queryClient.setQueryData(['daily-tasks', userId, role], context.previousTasks);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['daily-tasks', userId, role] });
        },
    });

    const handleToggle = (taskId: number) => {
        toggleMutation.mutate(taskId);
    };

    if (isLoading) {
        return (
            <div className="bg-white border border-gray-300 rounded-lg p-4">
                <p className="text-sm text-gray-600">Loading today's checklist...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-white border border-red-300 rounded-lg p-4">
                <p className="text-sm text-red-600">Error loading checklist. Please refresh.</p>
            </div>
        );
    }

    const tasks = data || [];
    const completedCount = tasks.filter(t => t.completed).length;
    const totalCount = tasks.length;
    const progressPercentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

    const today = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    return (
        <div className="bg-white border border-gray-300 rounded-lg p-4 shadow-sm">
            <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-lg font-bold text-[#0a192f]">
                        Today's Checklist - {today}
                    </h2>
                    <span className="text-xs text-gray-500">
                        {completedCount} / {totalCount} done
                    </span>
                </div>
                
                {/* Progress Bar */}
                <div className="w-full bg-gray-200 rounded-full h-2.5 mb-2">
                    <div
                        className={`h-2.5 rounded-full transition-all duration-300 ${
                            progressPercentage === 100
                                ? 'bg-green-500'
                                : progressPercentage >= 50
                                ? 'bg-blue-500'
                                : 'bg-yellow-500'
                        }`}
                        style={{ width: `${progressPercentage}%` }}
                    />
                </div>
                
                <p className="text-xs text-gray-600">
                    Shift starts ~8:30 AM. Complete all tasks by end of day.
                </p>
            </div>

            {tasks.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No tasks assigned for today.</p>
            ) : (
                <ul className="space-y-2">
                    {tasks.map((task) => (
                        <li
                            key={task.id}
                            className={`flex items-start gap-3 p-2 rounded border transition-colors ${
                                task.completed
                                    ? 'bg-green-50 border-green-200'
                                    : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={task.completed}
                                onChange={() => handleToggle(task.id)}
                                className="mt-1 w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                disabled={toggleMutation.isPending}
                            />
                            <label className="flex-1 cursor-pointer">
                                <span
                                    className={`block text-sm font-medium ${
                                        task.completed
                                            ? 'line-through text-gray-500'
                                            : 'text-gray-900'
                                    }`}
                                >
                                    {task.title}
                                </span>
                                {task.description && (
                                    <span
                                        className={`block text-xs mt-0.5 ${
                                            task.completed
                                                ? 'text-gray-400'
                                                : 'text-gray-600'
                                        }`}
                                    >
                                        {task.description}
                                    </span>
                                )}
                                {task.completed && task.completedAt && (
                                    <span className="block text-xs text-green-600 mt-1">
                                        ✓ Done at {new Date(task.completedAt).toLocaleTimeString('en-US', {
                                            hour: 'numeric',
                                            minute: '2-digit',
                                        })}
                                    </span>
                                )}
                            </label>
                        </li>
                    ))}
                </ul>
            )}

            <button
                onClick={() => queryClient.invalidateQueries({ queryKey: ['daily-tasks', userId, role] })}
                className="mt-4 text-xs text-blue-600 hover:text-blue-800 underline"
            >
                Refresh List
            </button>
        </div>
    );
};

export default DailyChecklist;
