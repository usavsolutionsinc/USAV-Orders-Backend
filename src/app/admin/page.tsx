'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Check, X } from '@/components/Icons';
import Navigation from '@/components/Navigation';

interface Staff {
    id: number;
    name: string;
    role: string;
    employee_id: string | null;
    active: boolean;
}

interface Tag {
    id: number;
    name: string;
    color: string;
}

const TAG_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

const TAG_COLOR_CLASSES = {
    red: 'bg-red-500',
    orange: 'bg-orange-500',
    yellow: 'bg-yellow-500',
    green: 'bg-green-500',
    blue: 'bg-blue-500',
    purple: 'bg-purple-500',
    gray: 'bg-gray-500',
};

export default function AdminPage() {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<'staff' | 'tags'>('staff');
    
    // Staff state
    const [isAddingStaff, setIsAddingStaff] = useState(false);
    const [newStaffName, setNewStaffName] = useState('');
    const [newStaffRole, setNewStaffRole] = useState<'technician' | 'packer'>('technician');
    const [newStaffEmployeeId, setNewStaffEmployeeId] = useState('');
    
    // Tag state
    const [isAddingTag, setIsAddingTag] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState('blue');
    const [editingTagId, setEditingTagId] = useState<number | null>(null);
    const [editTagName, setEditTagName] = useState('');
    const [editTagColor, setEditTagColor] = useState('blue');

    // Staff queries
    const { data: staff = [] } = useQuery<Staff[]>({
        queryKey: ['staff'],
        queryFn: async () => {
            const res = await fetch('/api/staff?active=false');
            if (!res.ok) throw new Error('Failed to fetch staff');
            return res.json();
        },
    });

    const createStaffMutation = useMutation({
        mutationFn: async (data: { name: string; role: string; employee_id: string }) => {
            const res = await fetch('/api/staff', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error('Failed to create staff');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['staff'] });
            setIsAddingStaff(false);
            setNewStaffName('');
            setNewStaffEmployeeId('');
        },
    });

    const toggleStaffMutation = useMutation({
        mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
            const res = await fetch('/api/staff', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, active }),
            });
            if (!res.ok) throw new Error('Failed to update staff');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['staff'] });
        },
    });

    // Tag queries
    const { data: tags = [] } = useQuery<Tag[]>({
        queryKey: ['tags'],
        queryFn: async () => {
            const res = await fetch('/api/tags');
            if (!res.ok) throw new Error('Failed to fetch tags');
            return res.json();
        },
    });

    const createTagMutation = useMutation({
        mutationFn: async (data: { name: string; color: string }) => {
            const res = await fetch('/api/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error('Failed to create tag');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            setIsAddingTag(false);
            setNewTagName('');
            setNewTagColor('blue');
        },
    });

    const updateTagMutation = useMutation({
        mutationFn: async ({ id, name, color }: { id: number; name: string; color: string }) => {
            const res = await fetch('/api/tags', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, name, color }),
            });
            if (!res.ok) throw new Error('Failed to update tag');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            setEditingTagId(null);
        },
    });

    const deleteTagMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await fetch(`/api/tags?id=${id}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to delete tag');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
        },
    });

    return (
        <div className="min-h-screen bg-gray-950 text-white">
            <Navigation />
            
            <div className="p-8">
                <div className="max-w-6xl mx-auto space-y-8">
                    <div>
                        <h1 className="text-4xl font-black tracking-tighter uppercase">Admin Panel</h1>
                        <p className="text-sm text-gray-400 mt-2">Manage staff members and tags</p>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => setActiveTab('staff')}
                            className={`px-6 py-3 rounded-xl font-black text-sm uppercase tracking-wider transition-all ${
                                activeTab === 'staff'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                            }`}
                        >
                            Staff Management
                        </button>
                        <button
                            onClick={() => setActiveTab('tags')}
                            className={`px-6 py-3 rounded-xl font-black text-sm uppercase tracking-wider transition-all ${
                                activeTab === 'tags'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                            }`}
                        >
                            Tags Management
                        </button>
                    </div>

                    {/* Staff Management */}
                    {activeTab === 'staff' && (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <h2 className="text-2xl font-black uppercase">Staff Members</h2>
                                <button
                                    onClick={() => setIsAddingStaff(true)}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-xl hover:bg-blue-500 transition-all text-sm font-black uppercase"
                                >
                                    <Plus className="w-4 h-4" />
                                    Add Staff
                                </button>
                            </div>

                            {isAddingStaff && (
                                <div className="p-6 bg-blue-600/10 rounded-2xl border border-blue-500/20 space-y-4">
                                    <input
                                        type="text"
                                        value={newStaffName}
                                        onChange={(e) => setNewStaffName(e.target.value)}
                                        placeholder="Staff name..."
                                        className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-sm font-bold outline-none"
                                    />
                                    <input
                                        type="text"
                                        value={newStaffEmployeeId}
                                        onChange={(e) => setNewStaffEmployeeId(e.target.value)}
                                        placeholder="Employee ID (optional)..."
                                        className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-sm font-bold outline-none"
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setNewStaffRole('technician')}
                                            className={`flex-1 py-2 rounded-xl text-xs font-black uppercase ${
                                                newStaffRole === 'technician' ? 'bg-blue-600' : 'bg-white/10'
                                            }`}
                                        >
                                            Technician
                                        </button>
                                        <button
                                            onClick={() => setNewStaffRole('packer')}
                                            className={`flex-1 py-2 rounded-xl text-xs font-black uppercase ${
                                                newStaffRole === 'packer' ? 'bg-blue-600' : 'bg-white/10'
                                            }`}
                                        >
                                            Packer
                                        </button>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                if (newStaffName.trim()) {
                                                    createStaffMutation.mutate({
                                                        name: newStaffName,
                                                        role: newStaffRole,
                                                        employee_id: newStaffEmployeeId,
                                                    });
                                                }
                                            }}
                                            className="flex-1 py-2 bg-emerald-600 rounded-xl text-xs font-black uppercase"
                                        >
                                            Create
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsAddingStaff(false);
                                                setNewStaffName('');
                                                setNewStaffEmployeeId('');
                                            }}
                                            className="flex-1 py-2 bg-white/10 rounded-xl text-xs font-black uppercase"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="grid gap-3">
                                {staff.map((member) => (
                                    <div
                                        key={member.id}
                                        className={`p-5 rounded-2xl border transition-all ${
                                            member.active
                                                ? 'bg-white/5 border-white/10'
                                                : 'bg-white/[0.02] border-white/5 opacity-50'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-black">
                                                    {member.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="text-lg font-black">{member.name}</div>
                                                    <div className="flex items-center gap-2 text-xs text-gray-400">
                                                        <span className="uppercase font-bold">{member.role}</span>
                                                        {member.employee_id && (
                                                            <>
                                                                <span>•</span>
                                                                <span className="font-mono">{member.employee_id}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => toggleStaffMutation.mutate({ id: member.id, active: !member.active })}
                                                className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-all ${
                                                    member.active
                                                        ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                                        : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                                }`}
                                            >
                                                {member.active ? 'Deactivate' : 'Activate'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Tags Management */}
                    {activeTab === 'tags' && (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <h2 className="text-2xl font-black uppercase">Tags</h2>
                                <button
                                    onClick={() => setIsAddingTag(true)}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-xl hover:bg-blue-500 transition-all text-sm font-black uppercase"
                                >
                                    <Plus className="w-4 h-4" />
                                    Add Tag
                                </button>
                            </div>

                            {isAddingTag && (
                                <div className="p-6 bg-blue-600/10 rounded-2xl border border-blue-500/20 space-y-4">
                                    <input
                                        type="text"
                                        value={newTagName}
                                        onChange={(e) => setNewTagName(e.target.value)}
                                        placeholder="Tag name..."
                                        className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-sm font-bold outline-none"
                                    />
                                    <div className="flex gap-2">
                                        {TAG_COLORS.map((color) => (
                                            <button
                                                key={color}
                                                onClick={() => setNewTagColor(color)}
                                                className={`w-10 h-10 rounded-full ${TAG_COLOR_CLASSES[color as keyof typeof TAG_COLOR_CLASSES]} ${
                                                    newTagColor === color ? 'ring-2 ring-white scale-110' : 'opacity-50'
                                                } transition-all`}
                                            />
                                        ))}
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                if (newTagName.trim()) {
                                                    createTagMutation.mutate({ name: newTagName, color: newTagColor });
                                                }
                                            }}
                                            className="flex-1 py-2 bg-emerald-600 rounded-xl text-xs font-black uppercase"
                                        >
                                            Create
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsAddingTag(false);
                                                setNewTagName('');
                                                setNewTagColor('blue');
                                            }}
                                            className="flex-1 py-2 bg-white/10 rounded-xl text-xs font-black uppercase"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="grid gap-3">
                                {tags.map((tag) => (
                                    <div key={tag.id} className="p-5 rounded-2xl bg-white/5 border border-white/10">
                                        {editingTagId === tag.id ? (
                                            <div className="space-y-3">
                                                <input
                                                    type="text"
                                                    value={editTagName}
                                                    onChange={(e) => setEditTagName(e.target.value)}
                                                    className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-xl text-sm font-bold outline-none"
                                                />
                                                <div className="flex gap-2">
                                                    {TAG_COLORS.map((color) => (
                                                        <button
                                                            key={color}
                                                            onClick={() => setEditTagColor(color)}
                                                            className={`w-8 h-8 rounded-full ${TAG_COLOR_CLASSES[color as keyof typeof TAG_COLOR_CLASSES]} ${
                                                                editTagColor === color ? 'ring-2 ring-white' : 'opacity-50'
                                                            } transition-all`}
                                                        />
                                                    ))}
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => {
                                                            updateTagMutation.mutate({ id: tag.id, name: editTagName, color: editTagColor });
                                                        }}
                                                        className="flex-1 py-2 bg-emerald-600 rounded-xl text-xs font-black uppercase"
                                                    >
                                                        Save
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingTagId(null)}
                                                        className="flex-1 py-2 bg-white/10 rounded-xl text-xs font-black uppercase"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-8 h-8 rounded-full ${TAG_COLOR_CLASSES[tag.color as keyof typeof TAG_COLOR_CLASSES]}`} />
                                                    <div className="text-lg font-black">{tag.name}</div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => {
                                                            setEditingTagId(tag.id);
                                                            setEditTagName(tag.name);
                                                            setEditTagColor(tag.color);
                                                        }}
                                                        className="p-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-all"
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => deleteTagMutation.mutate(tag.id)}
                                                        className="p-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-all"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

