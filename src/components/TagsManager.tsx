'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Pencil, Check } from './Icons';

interface Tag {
    id: number;
    name: string;
    color: string;
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

interface TagsManagerProps {
    taskTemplateId: number;
    selectedTags: Tag[];
    onTagsChange: () => void;
}

export default function TagsManager({ taskTemplateId, selectedTags, onTagsChange }: TagsManagerProps) {
    const queryClient = useQueryClient();
    const [isOpen, setIsOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState<keyof typeof TAG_COLORS>('blue');

    const { data: allTags = [] } = useQuery<Tag[]>({
        queryKey: ['tags'],
        queryFn: async () => {
            const res = await fetch('/api/tags');
            if (!res.ok) throw new Error('Failed to fetch tags');
            return res.json();
        },
    });

    const addTagMutation = useMutation({
        mutationFn: async (tagId: number) => {
            const res = await fetch('/api/task-tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskTemplateId, tagId }),
            });
            if (!res.ok) throw new Error('Failed to add tag');
        },
        onSuccess: () => {
            onTagsChange();
        },
    });

    const removeTagMutation = useMutation({
        mutationFn: async (tagId: number) => {
            const res = await fetch(`/api/task-tags?taskTemplateId=${taskTemplateId}&tagId=${tagId}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to remove tag');
        },
        onSuccess: () => {
            onTagsChange();
        },
    });

    const createTagMutation = useMutation({
        mutationFn: async ({ name, color }: { name: string; color: string }) => {
            const res = await fetch('/api/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color }),
            });
            if (!res.ok) throw new Error('Failed to create tag');
            return res.json();
        },
        onSuccess: (newTag) => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            addTagMutation.mutate(newTag.id);
            setIsCreating(false);
            setNewTagName('');
            setNewTagColor('blue');
        },
    });

    const selectedTagIds = selectedTags.map(t => t.id);
    const availableTags = allTags.filter(t => !selectedTagIds.includes(t.id));

    return (
        <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
                {selectedTags.map((tag) => {
                    const colorScheme = TAG_COLORS[tag.color as keyof typeof TAG_COLORS] || TAG_COLORS.gray;
                    return (
                        <button
                            key={tag.id}
                            onClick={() => removeTagMutation.mutate(tag.id)}
                            className={`group flex items-center gap-1.5 px-2 py-1 rounded-lg border ${colorScheme.bg} ${colorScheme.border} ${colorScheme.text} text-[10px] font-black uppercase tracking-wider transition-all hover:scale-105`}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${colorScheme.dot}`} />
                            {tag.name}
                            <X className="w-2.5 h-2.5 opacity-50 group-hover:opacity-100" />
                        </button>
                    );
                })}
                
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/40 hover:text-white/80 hover:bg-white/10 text-[10px] font-black uppercase tracking-wider transition-all"
                >
                    <Plus className="w-3 h-3" />
                    Tag
                </button>
            </div>

            {isOpen && (
                <>
                    <div 
                        className="fixed inset-0 z-10" 
                        onClick={() => { setIsOpen(false); setIsCreating(false); }}
                    />
                    <div className="absolute top-full left-0 mt-2 w-72 bg-gray-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-20 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
                            {isCreating ? (
                                <div className="p-3 bg-blue-500/10 rounded-xl space-y-3">
                                    <input
                                        type="text"
                                        value={newTagName}
                                        onChange={(e) => setNewTagName(e.target.value)}
                                        placeholder="Tag name..."
                                        className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-xs font-bold text-white outline-none"
                                        autoFocus
                                    />
                                    <div className="flex gap-2">
                                        {Object.keys(TAG_COLORS).map((color) => {
                                            const colorScheme = TAG_COLORS[color as keyof typeof TAG_COLORS];
                                            return (
                                                <button
                                                    key={color}
                                                    onClick={() => setNewTagColor(color as keyof typeof TAG_COLORS)}
                                                    className={`w-6 h-6 rounded-full ${colorScheme.dot} ${newTagColor === color ? 'ring-2 ring-white scale-110' : 'opacity-50'} transition-all`}
                                                />
                                            );
                                        })}
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                if (newTagName.trim()) {
                                                    createTagMutation.mutate({ name: newTagName, color: newTagColor });
                                                }
                                            }}
                                            className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest"
                                        >
                                            Create
                                        </button>
                                        <button
                                            onClick={() => { setIsCreating(false); setNewTagName(''); }}
                                            className="flex-1 py-1.5 bg-white/10 text-white rounded-lg text-[9px] font-black uppercase tracking-widest"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <button
                                        onClick={() => setIsCreating(true)}
                                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/30 transition-all text-xs font-black uppercase tracking-wider"
                                    >
                                        <Plus className="w-3 h-3" />
                                        Create New Tag
                                    </button>
                                    
                                    {availableTags.length > 0 ? (
                                        availableTags.map((tag) => {
                                            const colorScheme = TAG_COLORS[tag.color as keyof typeof TAG_COLORS] || TAG_COLORS.gray;
                                            return (
                                                <button
                                                    key={tag.id}
                                                    onClick={() => addTagMutation.mutate(tag.id)}
                                                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border ${colorScheme.bg} ${colorScheme.border} ${colorScheme.text} hover:scale-[1.02] transition-all text-[10px] font-black uppercase tracking-wider`}
                                                >
                                                    <div className={`w-2 h-2 rounded-full ${colorScheme.dot}`} />
                                                    {tag.name}
                                                </button>
                                            );
                                        })
                                    ) : (
                                        <div className="px-3 py-4 text-center text-xs text-gray-500">
                                            All tags are already added
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

