'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Check, X } from './Icons';
import TagsManager from './TagsManager';

interface Tag {
    id: number;
    name: string;
    color: string;
}

interface TaskTemplate {
    id: number;
    title: string;
    description: string | null;
    role: string;
    order_number: string | null;
    tracking_number: string | null;
    tags: Tag[];
    created_at: string;
}

interface TaskInstance {
    template_id: number;
    status: 'pending' | 'in_progress' | 'completed';
    started_at: string | null;
    completed_at: string | null;
    duration_minutes: number | null;
    notes: string | null;
    task_date: string;
}

interface ChecklistItem extends TaskTemplate {
    instance?: TaskInstance;
}

interface ChecklistProps {
    role: 'technician' | 'packer';
    userId?: string;
}

const TAG_COLORS = {
    red: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', dot: 'bg-red-500' },
    orange: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30', dot: 'bg-orange-500' },
    yellow: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30', dot: 'bg-yellow-500' },
    green: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', dot: 'bg-green-500' },
    blue: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30', dot: 'bg-blue-500' },
    purple: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', dot: 'bg-purple-500' },
    gray: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30', dot: 'bg-gray-500' },
};

export default function Checklist({ role, userId = '1' }: ChecklistProps) {
    const queryClient = useQueryClient();
    
    // Hardcoded staff ID logic - using userId as a proxy for station-specific staff
    const staffId = parseInt(userId);
    const staffName = `${role === 'technician' ? 'Tech' : 'Packer'} Station ${userId}`;

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editOrderNumber, setEditOrderNumber] = useState('');
    const [editTrackingNumber, setEditTrackingNumber] = useState('');
    
    const [isAdding, setIsAdding] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDescription, setNewDescription] = useState('');
    const [newOrderNumber, setNewOrderNumber] = useState('');
    const [newTrackingNumber, setNewTrackingNumber] = useState('');

    const { data: items = [], isLoading } = useQuery<ChecklistItem[]>({
        queryKey: ['checklist', role, staffId],
        queryFn: async () => {
            const res = await fetch(`/api/checklist?role=${role}&staffId=${staffId}`);
            if (!res.ok) throw new Error('Failed to fetch checklist');
            return res.json();
        },
    });

    const toggleMutation = useMutation({
        mutationFn: async ({ templateId, status, notes }: { templateId: number; status: string; notes?: string }) => {
            const res = await fetch('/api/checklist/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templateId, staffId, role, status, notes }),
            });
            if (!res.ok) throw new Error('Failed to update task');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklist', role, staffId] });
        },
    });

    const updateTemplateMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await fetch('/api/checklist/template', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error('Failed to update template');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklist', role, staffId] });
            setEditingId(null);
        },
    });

    const createTemplateMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await fetch('/api/checklist/template', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, ...data }),
            });
            if (!res.ok) throw new Error('Failed to create template');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklist', role, staffId] });
            setIsAdding(false);
            setNewTitle('');
            setNewDescription('');
            setNewOrderNumber('');
            setNewTrackingNumber('');
        },
    });

    const deleteTemplateMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await fetch(`/api/checklist/template?id=${id}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to delete template');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklist', role, staffId] });
        },
    });

    const handleAddNew = () => {
        if (newTitle.trim()) {
            createTemplateMutation.mutate({
                title: newTitle,
                description: newDescription,
                order_number: newOrderNumber,
                tracking_number: newTrackingNumber,
            });
        }
    };

    const formatDuration = (minutes: number) => {
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    };

    if (isLoading) return <div className="p-4 animate-pulse space-y-4"><div className="h-10 bg-gray-50 rounded-xl" /><div className="h-32 bg-gray-50 rounded-xl" /></div>;

    return (
        <div className="h-full flex flex-col bg-white text-gray-900">
            {/* Header - Station Info */}
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-black tracking-tighter uppercase text-gray-900">{staffName}</h2>
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[9px] font-black rounded uppercase border border-blue-100">{role}</span>
                </div>
            </div>

            {/* NEW TASK FORM - NOW AT TOP */}
            <div className="p-4 border-b border-gray-100">
                {isAdding ? (
                    <div className="space-y-3 bg-gray-50 p-4 rounded-2xl border border-blue-200 animate-in fade-in slide-in-from-top-2 shadow-sm">
                        <input
                            type="text"
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold focus:border-blue-500 outline-none text-gray-900"
                            placeholder="Task title..."
                            autoFocus
                        />
                        <textarea
                            value={newDescription}
                            onChange={(e) => setNewDescription(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-[10px] min-h-[60px] outline-none text-gray-600"
                            placeholder="Details..."
                        />
                        <div className="grid grid-cols-2 gap-2">
                            <input
                                type="text"
                                value={newOrderNumber}
                                onChange={(e) => setNewOrderNumber(e.target.value)}
                                className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-[9px] font-mono outline-none text-gray-900"
                                placeholder="Order #"
                            />
                            <input
                                type="text"
                                value={newTrackingNumber}
                                onChange={(e) => setNewTrackingNumber(e.target.value)}
                                className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-[9px] font-mono outline-none text-gray-900"
                                placeholder="Tracking #"
                            />
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleAddNew} className="flex-1 py-2 bg-blue-600 rounded-xl text-[10px] font-black uppercase tracking-wider text-white shadow-lg shadow-blue-100">Add</button>
                            <button onClick={() => setIsAdding(false)} className="flex-1 py-2 bg-gray-200 rounded-xl text-[10px] font-black uppercase text-gray-600">Cancel</button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={() => setIsAdding(true)}
                        className="w-full py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-all flex items-center justify-center gap-2"
                    >
                        <Plus className="w-3 h-3" /> New Task
                    </button>
                )}
            </div>

            {/* TASK LIST */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                {items.map((item) => {
                    const status = item.instance?.status || 'pending';
                    const isCompleted = status === 'completed';
                    const isInProgress = status === 'in_progress';

                    return (
                        <div
                            key={item.id}
                            className={`group relative p-4 rounded-2xl border transition-all ${
                                isCompleted ? 'bg-emerald-50 border-emerald-100 opacity-60' :
                                isInProgress ? 'bg-blue-50 border-blue-100 ring-1 ring-blue-50' :
                                'bg-white border-gray-100 hover:border-gray-200 shadow-sm'
                            }`}
                        >
                            <div className="flex gap-3">
                                <button
                                    onClick={() => {
                                        const nextStatus = status === 'pending' ? 'in_progress' : status === 'in_progress' ? 'completed' : 'pending';
                                        toggleMutation.mutate({ templateId: item.id, status: nextStatus });
                                    }}
                                    className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                                        isCompleted ? 'bg-emerald-500 border-emerald-500' :
                                        isInProgress ? 'bg-blue-500 border-blue-500' :
                                        'border-gray-200 hover:border-blue-400'
                                    }`}
                                >
                                    {isCompleted && <Check className="w-3 h-3 text-white" />}
                                    {isInProgress && <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />}
                                </button>

                                <div className="flex-1 min-w-0">
                                    <div className={`text-[11px] font-black tracking-tight ${isCompleted ? 'line-through text-emerald-600/50' : 'text-gray-900'}`}>
                                        {item.title}
                                    </div>
                                    {item.description && (
                                        <div className={`text-[9px] mt-1 leading-snug ${isCompleted ? 'line-through text-gray-400' : 'text-gray-500'}`}>
                                            {item.description}
                                        </div>
                                    )}
                                    
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {item.order_number && <div className="px-1.5 py-0.5 bg-gray-100 rounded text-[8px] font-mono text-gray-500 border border-gray-200">O: {item.order_number}</div>}
                                        {item.tracking_number && <div className="px-1.5 py-0.5 bg-gray-100 rounded text-[8px] font-mono text-gray-500 border border-gray-200">T: {item.tracking_number}</div>}
                                    </div>

                                    {item.instance && (
                                        <div className="mt-2 flex items-center gap-2 text-[8px] font-bold uppercase tracking-widest">
                                            {isInProgress && <span className="text-blue-600 animate-pulse">● Running</span>}
                                            {isCompleted && <span className="text-emerald-600">✓ Done {item.instance.duration_minutes ? `(${formatDuration(item.instance.duration_minutes)})` : ''}</span>}
                                        </div>
                                    )}
                                </div>

                                <button onClick={() => deleteTemplateMutation.mutate(item.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all">
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            <footer className="p-4 border-t border-gray-100 opacity-20 text-center">
                <p className="text-[7px] font-mono tracking-[0.2em] text-gray-900">USAV STATION</p>
            </footer>
        </div>
    );
}
