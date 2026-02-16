'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, Trash2, AlertTriangle } from './Icons';
import { formatDateTimePST } from '@/lib/timezone';

interface ReceivingTask {
    id: number;
    trackingNumber: string;
    orderNumber: string | null;
    status: string;
    receivedDate: string | null;
    processedDate: string | null;
    notes: string | null;
    staffId: number | null;
    createdAt: string;
}

export default function ReceivingTaskList() {
    const queryClient = useQueryClient();

    const { data: tasks = [], isLoading } = useQuery<ReceivingTask[]>({
        queryKey: ['receivingTasks'],
        queryFn: async () => {
            const res = await fetch('/api/receiving-tasks');
            if (!res.ok) throw new Error('Failed to fetch tasks');
            return res.json();
        },
        refetchInterval: 5000, // Refresh every 5 seconds
    });

    const updateTaskMutation = useMutation({
        mutationFn: async ({ id, status }: { id: number; status: string }) => {
            const processedDate = status === 'completed' ? new Date().toISOString() : null;
            const res = await fetch('/api/receiving-tasks', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status, processedDate }),
            });
            if (!res.ok) throw new Error('Failed to update task');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['receivingTasks'] });
        },
    });

    const deleteTaskMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await fetch(`/api/receiving-tasks?id=${id}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to delete task');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['receivingTasks'] });
        },
    });

    const getNextStatus = (currentStatus: string) => {
        if (currentStatus === 'pending') return 'in_progress';
        if (currentStatus === 'in_progress') return 'completed';
        return 'pending';
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return null;
        return formatDateTimePST(dateStr);
    };

    if (isLoading) {
        return (
            <div className="p-6 space-y-3">
                <div className="h-8 w-48 bg-gray-100 rounded-lg animate-pulse"></div>
                <div className="space-y-2">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-20 w-full bg-gray-50 rounded-xl animate-pulse"></div>
                    ))}
                </div>
            </div>
        );
    }

    const pendingTasks = tasks.filter(t => t.status === 'pending');
    const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
    const completedTasks = tasks.filter(t => t.status === 'completed');

    return (
        <div className="h-full flex flex-col bg-white text-gray-900 overflow-hidden">
            <div className="p-6 border-b border-gray-100 bg-gray-50">
                <h2 className="text-2xl font-black tracking-tighter uppercase leading-none text-gray-900">
                    Receiving Tasks
                </h2>
                <div className="flex gap-4 mt-4 text-xs font-bold uppercase tracking-wider">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-gray-300"></div>
                        <span className="text-gray-400">Pending: {pendingTasks.length}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                        <span className="text-blue-600">In Progress: {inProgressTasks.length}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                        <span className="text-emerald-600">Completed: {completedTasks.length}</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3 scrollbar-hide">
                {tasks.length === 0 && (
                    <div className="text-center py-12 text-gray-400">
                        <p className="text-sm font-medium">No receiving tasks yet</p>
                        <p className="text-xs mt-1">Add a tracking number to get started</p>
                    </div>
                )}

                {tasks.map((task) => {
                    const isCompleted = task.status === 'completed';
                    const isInProgress = task.status === 'in_progress';
                    const isPending = task.status === 'pending';

                    return (
                        <div
                            key={task.id}
                            className={`group relative flex items-start gap-4 p-4 rounded-2xl border transition-all ${
                                isCompleted 
                                    ? 'bg-emerald-50 border-emerald-100 opacity-75' 
                                    : isInProgress
                                    ? 'bg-blue-50 border-blue-100'
                                    : 'bg-gray-50 border-gray-200 hover:bg-white hover:border-blue-300'
                            }`}
                        >

                            <div className="relative mt-1">
                                <button
                                    onClick={() => {
                                        const nextStatus = getNextStatus(task.status);
                                        updateTaskMutation.mutate({ id: task.id, status: nextStatus });
                                    }}
                                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                                        isCompleted 
                                            ? 'bg-emerald-500 border-emerald-500' 
                                            : isInProgress
                                            ? 'bg-blue-500 border-blue-500 animate-pulse'
                                            : 'border-gray-300 bg-white hover:border-blue-500'
                                    }`}
                                >
                                    {isCompleted && <Check className="w-3 h-3 text-white" />}
                                    {isInProgress && (
                                        <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                                    )}
                                </button>
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <div className={`text-sm font-black font-mono ${
                                        isCompleted ? 'text-emerald-700/50 line-through' : 
                                        isInProgress ? 'text-blue-600' : 
                                        'text-gray-900'
                                    }`}>
                                        {task.trackingNumber.slice(-4)}
                                    </div>
                                    {task.orderNumber && (
                                        <div className="px-2 py-0.5 bg-gray-100 rounded text-[9px] font-mono text-gray-500">
                                            Order: {task.orderNumber}
                                        </div>
                                    )}
                                </div>

                                {task.notes && (
                                    <div className={`text-[11px] mt-1 font-medium ${
                                        isCompleted ? 'text-emerald-700/30 line-through' : 'text-gray-500'
                                    }`}>
                                        {task.notes}
                                    </div>
                                )}

                                <div className="mt-2 space-y-1">
                                    {isPending && (
                                        <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                                            Added {formatDate(task.createdAt)}
                                        </div>
                                    )}
                                    {isInProgress && (
                                        <div className="text-[9px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.3)]" />
                                            Processing...
                                        </div>
                                    )}
                                    {isCompleted && task.processedDate && (
                                        <div className="text-[9px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(52,211,153,0.3)]" />
                                            Processed {formatDate(task.processedDate)}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <button
                                onClick={() => deleteTaskMutation.mutate(task.id)}
                                className="opacity-0 group-hover:opacity-100 p-2 text-gray-300 hover:text-red-500 transition-all"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
