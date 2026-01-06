'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Check, X } from '@/components/Icons';

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
        <div className="flex-1 overflow-y-auto bg-gray-950 p-6">
            <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <div className="flex gap-1">
                        <button
                            onClick={() => setActiveTab('staff')}
                            className={`px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                                activeTab === 'staff' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'
                            }`}
                        >
                            Staff
                        </button>
                        <button
                            onClick={() => setActiveTab('tags')}
                            className={`px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                                activeTab === 'tags' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'
                            }`}
                        >
                            Tags
                        </button>
                    </div>
                    <button
                        onClick={() => activeTab === 'staff' ? setIsAddingStaff(true) : setIsAddingTag(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all text-[10px] font-black uppercase tracking-widest"
                    >
                        <Plus className="w-3 h-3" />
                        Add {activeTab === 'staff' ? 'Staff' : 'Tag'}
                    </button>
                </div>

                {activeTab === 'staff' ? (
                    <div className="space-y-3">
                        {isAddingStaff && (
                            <div className="p-5 bg-white/5 rounded-2xl border border-blue-500/30 space-y-4 animate-in fade-in slide-in-from-top-2">
                                <div className="grid grid-cols-2 gap-3">
                                    <input
                                        type="text"
                                        value={newStaffName}
                                        onChange={(e) => setNewStaffName(e.target.value)}
                                        placeholder="Name..."
                                        className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm font-bold outline-none focus:border-blue-500"
                                    />
                                    <input
                                        type="text"
                                        value={newStaffEmployeeId}
                                        onChange={(e) => setNewStaffEmployeeId(e.target.value)}
                                        placeholder="ID (optional)..."
                                        className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm font-bold outline-none focus:border-blue-500"
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setNewStaffRole('technician')}
                                        className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase border ${
                                            newStaffRole === 'technician' ? 'bg-blue-600 border-blue-500' : 'bg-white/5 border-white/10 text-gray-500'
                                        }`}
                                    >
                                        Technician
                                    </button>
                                    <button
                                        onClick={() => setNewStaffRole('packer')}
                                        className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase border ${
                                            newStaffRole === 'packer' ? 'bg-blue-600 border-blue-500' : 'bg-white/5 border-white/10 text-gray-500'
                                        }`}
                                    >
                                        Packer
                                    </button>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => newStaffName.trim() && createStaffMutation.mutate({ name: newStaffName, role: newStaffRole, employee_id: newStaffEmployeeId })}
                                        className="flex-1 py-2.5 bg-emerald-600 rounded-xl text-[10px] font-black uppercase shadow-lg shadow-emerald-900/20"
                                    >
                                        Create
                                    </button>
                                    <button onClick={() => setIsAddingStaff(false)} className="flex-1 py-2.5 bg-white/5 text-white rounded-xl text-[10px] font-black uppercase">Cancel</button>
                                </div>
                            </div>
                        )}

                        <div className="grid gap-2">
                            {staff.map((member) => (
                                <div key={member.id} className={`p-4 rounded-2xl bg-white/5 border border-white/5 transition-all ${!member.active && 'opacity-40'}`}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-xs font-black">
                                                {member.name.substring(0, 2).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="text-sm font-black">{member.name}</div>
                                                <div className="text-[9px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                                                    {member.role} {member.employee_id && <span>• {member.employee_id}</span>}
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => toggleStaffMutation.mutate({ id: member.id, active: !member.active })}
                                            className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase border transition-all ${
                                                member.active ? 'border-red-500/20 text-red-400 hover:bg-red-500/10' : 'border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10'
                                            }`}
                                        >
                                            {member.active ? 'Disable' : 'Enable'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {isAddingTag && (
                            <div className="p-5 bg-white/5 rounded-2xl border border-blue-500/30 space-y-4 animate-in fade-in slide-in-from-top-2">
                                <input
                                    type="text"
                                    value={newTagName}
                                    onChange={(e) => setNewTagName(e.target.value)}
                                    placeholder="Tag name..."
                                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm font-bold outline-none"
                                />
                                <div className="flex gap-2 justify-center">
                                    {TAG_COLORS.map((color) => (
                                        <button
                                            key={color}
                                            onClick={() => setNewTagColor(color)}
                                            className={`w-8 h-8 rounded-full ${TAG_COLOR_CLASSES[color as keyof typeof TAG_COLOR_CLASSES]} ${
                                                newTagColor === color ? 'ring-2 ring-white scale-110' : 'opacity-40'
                                            } transition-all`}
                                        />
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => newTagName.trim() && createTagMutation.mutate({ name: newTagName, color: newTagColor })}
                                        className="flex-1 py-2.5 bg-emerald-600 rounded-xl text-[10px] font-black uppercase shadow-lg shadow-emerald-900/20"
                                    >
                                        Create
                                    </button>
                                    <button onClick={() => setIsAddingTag(false)} className="flex-1 py-2.5 bg-white/5 text-white rounded-xl text-[10px] font-black uppercase">Cancel</button>
                                </div>
                            </div>
                        )}

                        <div className="grid gap-2">
                            {tags.map((tag) => (
                                <div key={tag.id} className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-3 h-3 rounded-full ${TAG_COLOR_CLASSES[tag.color as keyof typeof TAG_COLOR_CLASSES]} shadow-[0_0_10px_rgba(0,0,0,0.5)]`} />
                                        <div className="text-sm font-black uppercase tracking-tight">{tag.name}</div>
                                    </div>
                                    <button
                                        onClick={() => deleteTagMutation.mutate(tag.id)}
                                        className="p-2 text-gray-600 hover:text-red-400 transition-all"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
