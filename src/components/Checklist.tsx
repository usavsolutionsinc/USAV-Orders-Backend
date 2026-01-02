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
        <div className="h-full flex flex-col bg-white">
            <div className="p-6 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xl font-black tracking-tight text-gray-900 uppercase">
                        Station Tasks
                    </h2>
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded-md uppercase">
                        {role}
                    </span>
                </div>
                <p className="text-xs text-gray-500 font-medium mb-4 uppercase tracking-wider">
                    User ID: <span className="text-gray-900">#00{userId}</span>
                </p>
                <button
                    onClick={() => setIsAdding(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl hover:bg-blue-600 transition-all shadow-lg shadow-gray-200 text-xs font-bold uppercase tracking-widest"
                >
                    <Plus className="w-3 h-3" />
                    New Task
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                {items.map((item) => {
                    const isCompleted = item.instance?.completed || false;
                    const completedAt = item.instance?.completed_at;

                    return (
                        <div
                            key={item.id}
                            className={`group relative flex items-start gap-4 p-4 rounded-2xl border transition-all duration-300 ${
                                isCompleted 
                                    ? 'bg-emerald-50/50 border-emerald-100 opacity-75' 
                                    : 'bg-white border-gray-100 hover:border-blue-200 hover:shadow-xl hover:shadow-blue-50'
                            }`}
                            onDoubleClick={() => handleDoubleClick(item)}
                        >
                            <div className="relative mt-1">
                                <input
                                    type="checkbox"
                                    checked={isCompleted}
                                    onChange={() => toggleMutation.mutate({ templateId: item.id, completed: !isCompleted })}
                                    className="w-5 h-5 rounded-full border-2 border-gray-300 text-blue-600 focus:ring-blue-500 transition-all cursor-pointer appearance-none checked:bg-blue-600 checked:border-blue-600"
                                />
                                {isCompleted && (
                                    <Check className="w-3 h-3 text-white absolute top-1 left-1 pointer-events-none" />
                                )}
                            </div>

                            <div className="flex-1 min-w-0">
                                {editingId === item.id ? (
                                    <div className="space-y-3">
                                        <input
                                            type="text"
                                            value={editTitle}
                                            onChange={(e) => setEditTitle(e.target.value)}
                                            className="w-full px-3 py-2 bg-white border border-blue-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                                            autoFocus
                                        />
                                        <textarea
                                            value={editDescription}
                                            onChange={(e) => setEditDescription(e.target.value)}
                                            className="w-full px-3 py-2 bg-white border border-blue-300 rounded-lg text-xs min-h-[60px] outline-none"
                                        />
                                        <div className="flex gap-2">
                                            <button onClick={handleSaveEdit} className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold uppercase">Save</button>
                                            <button onClick={() => setEditingId(null)} className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg text-xs font-bold uppercase">Cancel</button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className={`text-sm font-bold transition-all ${isCompleted ? 'text-emerald-800/50 line-through' : 'text-gray-900'}`}>
                                            {item.title}
                                        </div>
                                        {item.description && (
                                            <div className={`text-[11px] mt-1 leading-relaxed ${isCompleted ? 'text-emerald-600/50 line-through' : 'text-gray-500'}`}>
                                                {item.description}
                                            </div>
                                        )}
                                        {isCompleted && completedAt && (
                                            <div className="text-[9px] font-black text-emerald-600 mt-2 uppercase tracking-tighter flex items-center gap-1">
                                                <div className="w-1 h-1 bg-emerald-600 rounded-full animate-pulse" />
                                                Logged {new Date(completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {!editingId && (
                                <button
                                    onClick={() => deleteTemplateMutation.mutate(item.id)}
                                    className="opacity-0 group-hover:opacity-100 p-1.5 text-red-400 hover:text-red-600 transition-all absolute top-2 right-2"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    );
                })}

                {isAdding && (
                    <div className="p-4 bg-blue-50 rounded-2xl border border-blue-200 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <input
                            type="text"
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-blue-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="Task Title..."
                            autoFocus
                        />
                        <textarea
                            value={newDescription}
                            onChange={(e) => setNewDescription(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-blue-300 rounded-lg text-xs min-h-[60px] outline-none"
                            placeholder="Add details..."
                        />
                        <div className="flex gap-2">
                            <button onClick={handleAddNew} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold uppercase">Add Task</button>
                            <button onClick={() => setIsAdding(false)} className="flex-1 py-2 bg-white text-gray-500 rounded-lg text-xs font-bold uppercase border border-gray-200">Cancel</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
