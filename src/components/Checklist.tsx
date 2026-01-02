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
        return <div className="p-4 text-gray-500">Loading checklist...</div>;
    }

    return (
        <div className="bg-white border-b border-gray-200 shadow-sm">
            <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-bold text-gray-900">
                        Daily Checklist - {role === 'technician' ? 'Technician' : 'Packer'}
                    </h2>
                    <button
                        onClick={() => setIsAdding(true)}
                        className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
                    >
                        <Plus className="w-4 h-4" />
                        Add Task
                    </button>
                </div>

                <div className="space-y-2">
                    {items.map((item) => {
                        const isCompleted = item.instance?.completed || false;
                        const completedAt = item.instance?.completed_at;

                        return (
                            <div
                                key={item.id}
                                className="flex items-start gap-3 p-3 bg-gray-50 rounded border border-gray-200 hover:bg-gray-100 transition-colors"
                                onDoubleClick={() => handleDoubleClick(item)}
                            >
                                {editingId === item.id ? (
                                    <div className="flex-1 space-y-2">
                                        <input
                                            type="text"
                                            value={editTitle}
                                            onChange={(e) => setEditTitle(e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                            placeholder="Title"
                                            autoFocus
                                        />
                                        <input
                                            type="text"
                                            value={editDescription}
                                            onChange={(e) => setEditDescription(e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                            placeholder="Description (optional)"
                                        />
                                        <div className="flex gap-2">
                                            <button
                                                onClick={handleSaveEdit}
                                                className="flex items-center gap-1 px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-xs"
                                            >
                                                <Check className="w-3 h-3" />
                                                Save
                                            </button>
                                            <button
                                                onClick={() => setEditingId(null)}
                                                className="flex items-center gap-1 px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 text-xs"
                                            >
                                                <X className="w-3 h-3" />
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <input
                                            type="checkbox"
                                            checked={isCompleted}
                                            onChange={() => toggleMutation.mutate({ templateId: item.id, completed: !isCompleted })}
                                            className="mt-1 w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                                        />
                                        <div className="flex-1">
                                            <div className={`font-medium ${isCompleted ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                                                {item.title}
                                            </div>
                                            {item.description && (
                                                <div className={`text-sm mt-1 ${isCompleted ? 'line-through text-gray-400' : 'text-gray-600'}`}>
                                                    {item.description}
                                                </div>
                                            )}
                                            {isCompleted && completedAt && (
                                                <div className="text-xs text-green-600 mt-1">
                                                    ✓ Completed: {new Date(completedAt).toLocaleString()}
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => deleteTemplateMutation.mutate(item.id)}
                                            className="text-red-500 hover:text-red-700 p-1"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </>
                                )}
                            </div>
                        );
                    })}

                    {isAdding && (
                        <div className="p-3 bg-blue-50 rounded border border-blue-200 space-y-2">
                            <input
                                type="text"
                                value={newTitle}
                                onChange={(e) => setNewTitle(e.target.value)}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                placeholder="New task title"
                                autoFocus
                            />
                            <input
                                type="text"
                                value={newDescription}
                                onChange={(e) => setNewDescription(e.target.value)}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                placeholder="Description (optional)"
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={handleAddNew}
                                    className="flex items-center gap-1 px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-xs"
                                >
                                    <Check className="w-3 h-3" />
                                    Add
                                </button>
                                <button
                                    onClick={() => {
                                        setIsAdding(false);
                                        setNewTitle('');
                                        setNewDescription('');
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 text-xs"
                                >
                                    <X className="w-3 h-3" />
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
