'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Check, X } from './Icons';

interface TaskTemplate {
    id: number;
    title: string;
    description: string | null;
    role: string;
    created_at: string;
}

interface TaskInstance {
    template_id: number;
    completed: boolean;
    completed_at: string | null;
    task_date: string;
}

interface ChecklistItem extends TaskTemplate {
    instance?: TaskInstance;
}

interface ChecklistProps {
    role: 'technician' | 'packer';
    userId: string;
}

export default function Checklist({ role, userId }: ChecklistProps) {
    const queryClient = useQueryClient();
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDescription, setNewDescription] = useState('');

    const { data: items = [], isLoading } = useQuery<ChecklistItem[]>({
        queryKey: ['checklist', role, userId],
        queryFn: async () => {
            const res = await fetch(`/api/checklist?role=${role}&userId=${userId}`);
            if (!res.ok) throw new Error('Failed to fetch checklist');
            return res.json();
        },
    });

    const toggleMutation = useMutation({
        mutationFn: async ({ templateId, completed }: { templateId: number; completed: boolean }) => {
            const res = await fetch('/api/checklist/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templateId, userId, role, completed }),
            });
            if (!res.ok) throw new Error('Failed to update task');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklist', role, userId] });
        },
    });

    const updateTemplateMutation = useMutation({
        mutationFn: async ({ id, title, description }: { id: number; title: string; description: string }) => {
            const res = await fetch('/api/checklist/template', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, title, description }),
            });
            if (!res.ok) throw new Error('Failed to update template');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklist', role, userId] });
            setEditingId(null);
        },
    });

    const createTemplateMutation = useMutation({
        mutationFn: async ({ title, description }: { title: string; description: string }) => {
            const res = await fetch('/api/checklist/template', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, title, description }),
            });
            if (!res.ok) throw new Error('Failed to create template');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklist', role, userId] });
            setIsAdding(false);
            setNewTitle('');
            setNewDescription('');
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
            queryClient.invalidateQueries({ queryKey: ['checklist', role, userId] });
        },
    });

    const handleDoubleClick = (item: ChecklistItem) => {
        setEditingId(item.id);
        setEditTitle(item.title);
        setEditDescription(item.description || '');
    };

    const handleSaveEdit = () => {
        if (editingId && editTitle.trim()) {
            updateTemplateMutation.mutate({
                id: editingId,
                title: editTitle,
                description: editDescription,
            });
        }
    };

    const handleAddNew = () => {
        if (newTitle.trim()) {
            createTemplateMutation.mutate({
                title: newTitle,
                description: newDescription,
            });
        }
    };

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
            <div className="p-8 space-y-2 border-b border-white/5 bg-white/5">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-black tracking-tighter uppercase leading-none">
                        Station Tasks
                    </h2>
                    <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-[10px] font-black rounded-md uppercase tracking-widest">
                        {role}
                    </span>
                </div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.3em]">
                    User ID: #00{userId}
                </p>
                <button
                    onClick={() => setIsAdding(true)}
                    className="w-full mt-6 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-500 transition-all shadow-[0_10px_20px_rgba(37,99,235,0.2)] text-[10px] font-black uppercase tracking-widest"
                >
                    <Plus className="w-3 h-3" />
                    New Task
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
                {items.map((item) => {
                    const isCompleted = item.instance?.completed || false;
                    const completedAt = item.instance?.completed_at;

                    return (
                        <div
                            key={item.id}
                            className={`group relative flex items-start gap-4 p-5 rounded-3xl border transition-all duration-300 ${
                                isCompleted 
                                    ? 'bg-emerald-500/10 border-emerald-500/20 opacity-75' 
                                    : 'bg-white/5 border-white/10 hover:bg-white/[0.08] hover:border-white/20'
                            }`}
                            onDoubleClick={() => handleDoubleClick(item)}
                        >
                            <div className="relative mt-1">
                                <input
                                    type="checkbox"
                                    checked={isCompleted}
                                    onChange={() => toggleMutation.mutate({ templateId: item.id, completed: !isCompleted })}
                                    className="w-5 h-5 rounded-full border-2 border-white/20 bg-transparent text-blue-500 focus:ring-blue-500 transition-all cursor-pointer appearance-none checked:bg-blue-500 checked:border-blue-500"
                                />
                                {isCompleted && (
                                    <Check className="w-3 h-3 text-white absolute top-1 left-1 pointer-events-none" />
                                )}
                            </div>

                            <div className="flex-1 min-w-0">
                                {editingId === item.id ? (
                                    <div className="space-y-4">
                                        <input
                                            type="text"
                                            value={editTitle}
                                            onChange={(e) => setEditTitle(e.target.value)}
                                            className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none text-white"
                                            autoFocus
                                        />
                                        <textarea
                                            value={editDescription}
                                            onChange={(e) => setEditDescription(e.target.value)}
                                            className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-xl text-xs min-h-[80px] outline-none text-gray-300"
                                        />
                                        <div className="flex gap-2">
                                            <button onClick={handleSaveEdit} className="flex-1 py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Save</button>
                                            <button onClick={() => setEditingId(null)} className="flex-1 py-2 bg-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Cancel</button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className={`text-sm font-black tracking-tight transition-all ${isCompleted ? 'text-emerald-400/50 line-through' : 'text-white'}`}>
                                            {item.title}
                                        </div>
                                        {item.description && (
                                            <div className={`text-[11px] mt-1.5 leading-relaxed font-medium ${isCompleted ? 'text-emerald-400/30 line-through' : 'text-gray-400'}`}>
                                                {item.description}
                                            </div>
                                        )}
                                        {isCompleted && completedAt && (
                                            <div className="text-[9px] font-black text-emerald-400 mt-3 uppercase tracking-widest flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.5)]" />
                                                Logged {new Date(completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                    <div className="p-6 bg-blue-600/10 rounded-3xl border border-blue-500/20 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
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
                            className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-xl text-xs min-h-[80px] outline-none text-gray-300"
                            placeholder="Add details..."
                        />
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
