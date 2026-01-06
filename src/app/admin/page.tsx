'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Check, X } from '@/components/Icons';
import { motion } from 'framer-motion';

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
        <div className="flex-1 overflow-y-auto bg-gray-950 p-8">
            <div className="max-w-4xl mx-auto space-y-8">
                <header className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-black uppercase tracking-tighter text-white">Management</h1>
                        <p className="text-[10px] font-bold text-blue-500 uppercase tracking-[0.4em] mt-1">Control Center</p>
                    </div>
                    <div className="flex gap-2 bg-white/5 p-1 rounded-2xl border border-white/5">
                        <button
                            onClick={() => setActiveTab('staff')}
                            className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                                activeTab === 'staff' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-gray-500 hover:text-white'
                            }`}
                        >
                            Staff
                        </button>
                        <button
                            onClick={() => setActiveTab('tags')}
                            className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                                activeTab === 'tags' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-gray-500 hover:text-white'
                            }`}
                        >
                            Tags
                        </button>
                    </div>
                </header>

                <div className="grid gap-6">
                    {activeTab === 'staff' ? (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <h2 className="text-sm font-black uppercase tracking-widest text-white">Active Personnel</h2>
                                <button
                                    onClick={() => setIsAddingStaff(true)}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white"
                                >
                                    <Plus className="w-3.5 h-3.5" /> New Staff
                                </button>
                            </div>

                            {isAddingStaff && (
                                <motion.div 
                                    initial={{ opacity: 0, y: -20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="p-6 bg-white/5 rounded-3xl border border-blue-500/30 space-y-4"
                                >
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black text-gray-500 uppercase px-2 tracking-widest">Full Name</label>
                                            <input
                                                type="text"
                                                value={newStaffName}
                                                onChange={(e) => setNewStaffName(e.target.value)}
                                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-white font-bold text-sm outline-none focus:border-blue-500 transition-all"
                                                placeholder="Enter name..."
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black text-gray-500 uppercase px-2 tracking-widest">Employee ID</label>
                                            <input
                                                type="text"
                                                value={newStaffEmployeeId}
                                                onChange={(e) => setNewStaffEmployeeId(e.target.value)}
                                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-white font-bold text-sm outline-none focus:border-blue-500 transition-all"
                                                placeholder="Enter ID..."
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black text-gray-500 uppercase px-2 tracking-widest">Assign Role</label>
                                        <div className="flex gap-2">
                                            {['technician', 'packer'].map((r) => (
                                                <button
                                                    key={r}
                                                    onClick={() => setNewStaffRole(r as any)}
                                                    className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border ${
                                                        newStaffRole === r ? 'bg-blue-600 border-blue-500 text-white' : 'bg-white/5 border-white/10 text-gray-500 hover:text-white'
                                                    }`}
                                                >
                                                    {r}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex gap-2 pt-2">
                                        <button
                                            onClick={() => newStaffName.trim() && createStaffMutation.mutate({ name: newStaffName, role: newStaffRole, employee_id: newStaffEmployeeId })}
                                            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-900/20 transition-all"
                                        >
                                            Add Personnel
                                        </button>
                                        <button onClick={() => setIsAddingStaff(false)} className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all">Cancel</button>
                                    </div>
                                </motion.div>
                            )}

                            <div className="grid gap-3">
                                {staff.map((member) => (
                                    <div key={member.id} className={`p-5 rounded-3xl bg-white/5 border border-white/5 transition-all group hover:bg-white/[0.08] ${!member.active && 'opacity-40 grayscale'}`}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-5">
                                                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-700 flex items-center justify-center text-sm font-black shadow-lg shadow-blue-900/20 text-white">
                                                    {member.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="text-base font-black text-white">{member.name}</div>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest">{member.role}</span>
                                                        {member.employee_id && <span className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">• ID: {member.employee_id}</span>}
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => toggleStaffMutation.mutate({ id: member.id, active: !member.active })}
                                                className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
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
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <h2 className="text-sm font-black uppercase tracking-widest text-white">Task Metadata Tags</h2>
                                <button
                                    onClick={() => setIsAddingTag(true)}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white"
                                >
                                    <Plus className="w-3.5 h-3.5" /> New Tag
                                </button>
                            </div>

                            {isAddingTag && (
                                <motion.div 
                                    initial={{ opacity: 0, y: -20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="p-6 bg-white/5 rounded-3xl border border-blue-500/30 space-y-5"
                                >
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black text-gray-500 uppercase px-2 tracking-widest">Tag Label</label>
                                        <input
                                            type="text"
                                            value={newTagName}
                                            onChange={(e) => setNewTagName(e.target.value)}
                                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-white font-bold text-sm outline-none focus:border-blue-500 transition-all"
                                            placeholder="Urgent, Testing, Repair..."
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[9px] font-black text-gray-500 uppercase px-2 tracking-widest">Color ID</label>
                                        <div className="flex gap-3 justify-center bg-black/20 p-4 rounded-2xl">
                                            {TAG_COLORS.map((color) => (
                                                <button
                                                    key={color}
                                                    onClick={() => setNewTagColor(color)}
                                                    className={`w-10 h-10 rounded-full ${TAG_COLOR_CLASSES[color as keyof typeof TAG_COLOR_CLASSES]} ${
                                                        newTagColor === color ? 'ring-4 ring-white scale-110' : 'opacity-40 hover:opacity-60'
                                                    } transition-all shadow-xl`}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => newTagName.trim() && createTagMutation.mutate({ name: newTagName, color: newTagColor })}
                                            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-900/20 transition-all"
                                        >
                                            Generate Tag
                                        </button>
                                        <button onClick={() => setIsAddingTag(false)} className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all">Cancel</button>
                                    </div>
                                </motion.div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                                {tags.map((tag) => (
                                    <div key={tag.id} className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between group hover:bg-white/[0.08] transition-all">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-4 h-4 rounded-full ${TAG_COLOR_CLASSES[tag.color as keyof typeof TAG_COLOR_CLASSES]} shadow-[0_0_15px_rgba(0,0,0,0.5)] ring-2 ring-white/10`} />
                                            <div className="text-xs font-black uppercase tracking-widest text-white">{tag.name}</div>
                                        </div>
                                        <button
                                            onClick={() => deleteTagMutation.mutate(tag.id)}
                                            className="p-2 text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
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
        </div>
    );
}
