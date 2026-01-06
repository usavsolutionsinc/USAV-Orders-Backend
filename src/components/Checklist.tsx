'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Check, X } from './Icons';
import StaffSelector from './StaffSelector';
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

export default function Checklist({ role }: ChecklistProps) {
    const queryClient = useQueryClient();
    const [staffId, setStaffId] = useState<number | null>(null);
    const [staffName, setStaffName] = useState<string>('');
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

    // Load staff from localStorage
    useEffect(() => {
        const savedStaffId = localStorage.getItem(`${role}_staffId`);
        const savedStaffName = localStorage.getItem(`${role}_staffName`);
        if (savedStaffId && savedStaffName) {
            setStaffId(parseInt(savedStaffId));
            setStaffName(savedStaffName);
        }
    }, [role]);

    const handleStaffSelect = (id: number, name: string) => {
        setStaffId(id);
        setStaffName(name);
        localStorage.setItem(`${role}_staffId`, id.toString());
        localStorage.setItem(`${role}_staffName`, name);
    };

    const { data: items = [], isLoading } = useQuery<ChecklistItem[]>({
        queryKey: ['checklist', role, staffId],
        queryFn: async () => {
            if (!staffId) return [];
            const res = await fetch(`/api/checklist?role=${role}&staffId=${staffId}`);
            if (!res.ok) throw new Error('Failed to fetch checklist');
            return res.json();
        },
        enabled: !!staffId,
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
        mutationFn: async ({ id, title, description, order_number, tracking_number }: { 
            id: number; 
            title: string; 
            description: string;
            order_number: string;
            tracking_number: string;
        }) => {
            const res = await fetch('/api/checklist/template', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, title, description, order_number, tracking_number }),
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
        mutationFn: async ({ title, description, order_number, tracking_number }: { 
            title: string; 
            description: string;
            order_number: string;
            tracking_number: string;
        }) => {
            const res = await fetch('/api/checklist/template', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, title, description, order_number, tracking_number }),
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

    const handleDoubleClick = (item: ChecklistItem) => {
        setEditingId(item.id);
        setEditTitle(item.title);
        setEditDescription(item.description || '');
        setEditOrderNumber(item.order_number || '');
        setEditTrackingNumber(item.tracking_number || '');
    };

    const handleSaveEdit = () => {
        if (editingId && editTitle.trim()) {
            updateTemplateMutation.mutate({
                id: editingId,
                title: editTitle,
                description: editDescription,
                order_number: editOrderNumber,
                tracking_number: editTrackingNumber,
            });
        }
    };

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

    const getNextStatus = (currentStatus?: string) => {
        if (!currentStatus || currentStatus === 'pending') return 'in_progress';
        if (currentStatus === 'in_progress') return 'completed';
        return 'pending';
    };

    const formatDuration = (minutes: number) => {
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    };

    if (!staffId) {
        return (
            <div className="h-full flex flex-col bg-gray-950 text-white p-8">
                <div className="space-y-4">
                    <h2 className="text-2xl font-black tracking-tighter uppercase leading-none">
                        Select Staff Member
                    </h2>
                    <p className="text-sm text-gray-400 font-medium">
                        Choose who is working at this {role} station
                    </p>
                    <StaffSelector role={role} selectedStaffId={staffId} onSelect={handleStaffSelect} />
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="p-8 space-y-4">
                <div className="h-8 w-48 bg-gray-100 rounded-lg animate-pulse"></div>
                <div className="space-y-3">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-16 w-full bg-gray-50 rounded-xl animate-pulse"></div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-gray-950 text-white">
            <div className="p-8 space-y-4 border-b border-white/5 bg-white/5">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-black tracking-tighter uppercase leading-none">
                            Station Tasks
                        </h2>
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.3em] mt-1">
                            {staffName}
                        </p>
                    </div>
                    <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-[10px] font-black rounded-md uppercase tracking-widest">
                        {role}
                    </span>
                </div>
                
                <StaffSelector role={role} selectedStaffId={staffId} onSelect={handleStaffSelect} />

                <button
                    onClick={() => setIsAdding(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-500 transition-all shadow-[0_10px_20px_rgba(37,99,235,0.2)] text-[10px] font-black uppercase tracking-widest"
                >
                    <Plus className="w-3 h-3" />
                    New Task
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
                {items.map((item) => {
                    const status = item.instance?.status || 'pending';
                    const isCompleted = status === 'completed';
                    const isInProgress = status === 'in_progress';

                    return (
                        <div
                            key={item.id}
                            className={`group relative flex items-start gap-4 p-5 rounded-3xl border transition-all duration-300 ${
                                isCompleted 
                                    ? 'bg-emerald-500/10 border-emerald-500/20 opacity-75' 
                                    : isInProgress
                                    ? 'bg-blue-500/10 border-blue-500/20 ring-2 ring-blue-500/20'
                                    : 'bg-white/5 border-white/10 hover:bg-white/[0.08] hover:border-white/20'
                            }`}
                            onDoubleClick={() => !editingId && handleDoubleClick(item)}
                        >
                            <div className="relative mt-1">
                                <button
                                    onClick={() => {
                                        const nextStatus = getNextStatus(status);
                                        toggleMutation.mutate({ templateId: item.id, status: nextStatus });
                                    }}
                                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                                        isCompleted 
                                            ? 'bg-emerald-500 border-emerald-500' 
                                            : isInProgress
                                            ? 'bg-blue-500 border-blue-500 animate-pulse'
                                            : 'border-white/20 bg-transparent hover:border-blue-500'
                                    }`}
                                >
                                    {isCompleted && <Check className="w-3 h-3 text-white" />}
                                    {isInProgress && (
                                        <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                                    )}
                                </button>
                            </div>

                            <div className="flex-1 min-w-0">
                                {editingId === item.id ? (
                                    <div className="space-y-3">
                                        <input
                                            type="text"
                                            value={editTitle}
                                            onChange={(e) => setEditTitle(e.target.value)}
                                            className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none text-white"
                                            placeholder="Task title"
                                            autoFocus
                                        />
                                        <textarea
                                            value={editDescription}
                                            onChange={(e) => setEditDescription(e.target.value)}
                                            className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-xl text-xs min-h-[60px] outline-none text-gray-300"
                                            placeholder="Description..."
                                        />
                                        <div className="grid grid-cols-2 gap-2">
                                            <input
                                                type="text"
                                                value={editOrderNumber}
                                                onChange={(e) => setEditOrderNumber(e.target.value)}
                                                className="px-3 py-2 bg-white/10 border border-white/20 rounded-xl text-xs font-mono outline-none text-gray-300"
                                                placeholder="Order #"
                                            />
                                            <input
                                                type="text"
                                                value={editTrackingNumber}
                                                onChange={(e) => setEditTrackingNumber(e.target.value)}
                                                className="px-3 py-2 bg-white/10 border border-white/20 rounded-xl text-xs font-mono outline-none text-gray-300"
                                                placeholder="Tracking #"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={handleSaveEdit} className="flex-1 py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Save</button>
                                            <button onClick={() => setEditingId(null)} className="flex-1 py-2 bg-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Cancel</button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className={`text-sm font-black tracking-tight transition-all ${isCompleted ? 'text-emerald-400/50 line-through' : isInProgress ? 'text-blue-400' : 'text-white'}`}>
                                            {item.title}
                                        </div>
                                        
                                        {item.description && (
                                            <div className={`text-[11px] mt-1.5 leading-relaxed font-medium ${isCompleted ? 'text-emerald-400/30 line-through' : 'text-gray-400'}`}>
                                                {item.description}
                                            </div>
                                        )}

                                        {(item.order_number || item.tracking_number) && (
                                            <div className="flex flex-wrap gap-2 mt-2">
                                                {item.order_number && (
                                                    <div className="px-2 py-1 bg-white/5 rounded-lg text-[9px] font-mono text-gray-400">
                                                        Order: {item.order_number}
                                                    </div>
                                                )}
                                                {item.tracking_number && (
                                                    <div className="px-2 py-1 bg-white/5 rounded-lg text-[9px] font-mono text-gray-400">
                                                        Tracking: {item.tracking_number}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {item.tags && item.tags.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5 mt-2">
                                                {item.tags.map((tag) => {
                                                    const colorScheme = TAG_COLORS[tag.color as keyof typeof TAG_COLORS] || TAG_COLORS.gray;
                                                    return (
                                                        <div
                                                            key={tag.id}
                                                            className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border ${colorScheme.bg} ${colorScheme.border} ${colorScheme.text} text-[9px] font-black uppercase tracking-wider`}
                                                        >
                                                            <div className={`w-1 h-1 rounded-full ${colorScheme.dot}`} />
                                                            {tag.name}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        <div className="mt-2">
                                            <TagsManager 
                                                taskTemplateId={item.id} 
                                                selectedTags={item.tags || []}
                                                onTagsChange={() => queryClient.invalidateQueries({ queryKey: ['checklist', role, staffId] })}
                                            />
                                        </div>

                                        {item.instance && (
                                            <div className="mt-3 space-y-1">
                                                {isInProgress && item.instance.started_at && (
                                                    <div className="text-[9px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">
                                                        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                                                        Started {new Date(item.instance.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                )}
                                                {isCompleted && item.instance.completed_at && (
                                                    <div className="text-[9px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                                                        <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full shadow-[0_0_10px_rgba(52,211,153,0.5)]" />
                                                        Completed {new Date(item.instance.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        {item.instance.duration_minutes && (
                                                            <span className="ml-1">• Duration: {formatDuration(item.instance.duration_minutes)}</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {!editingId && (
                                <button
                                    onClick={() => deleteTemplateMutation.mutate(item.id)}
                                    className="opacity-0 group-hover:opacity-100 p-2 text-white/20 hover:text-red-400 transition-all absolute top-2 right-2"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    );
                })}

                {isAdding && (
                    <div className="p-6 bg-blue-600/10 rounded-3xl border border-blue-500/20 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <input
                            type="text"
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none text-white"
                            placeholder="Task Title..."
                            autoFocus
                        />
                        <textarea
                            value={newDescription}
                            onChange={(e) => setNewDescription(e.target.value)}
                            className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-xl text-xs min-h-[60px] outline-none text-gray-300"
                            placeholder="Add details..."
                        />
                        <div className="grid grid-cols-2 gap-2">
                            <input
                                type="text"
                                value={newOrderNumber}
                                onChange={(e) => setNewOrderNumber(e.target.value)}
                                className="px-3 py-2 bg-white/10 border border-white/20 rounded-xl text-xs font-mono outline-none text-gray-300"
                                placeholder="Order # (optional)"
                            />
                            <input
                                type="text"
                                value={newTrackingNumber}
                                onChange={(e) => setNewTrackingNumber(e.target.value)}
                                className="px-3 py-2 bg-white/10 border border-white/20 rounded-xl text-xs font-mono outline-none text-gray-300"
                                placeholder="Tracking # (optional)"
                            />
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleAddNew} className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Add Task</button>
                            <button onClick={() => setIsAdding(false)} className="flex-1 py-2 bg-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Cancel</button>
                        </div>
                    </div>
                )}
            </div>

            <footer className="p-6 border-t border-white/5 opacity-30 mt-auto">
                <p className="text-[8px] font-mono uppercase tracking-[0.4em]">USAV OS STATION // CORE v2.0</p>
            </footer>
        </div>
    );
}
