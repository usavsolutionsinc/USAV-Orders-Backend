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

interface Order {
    id: number;
    ship_by_date: string;
    order_id: string;
    product_title: string;
    sku: string;
    assigned_to: string | null;
    status: string;
    urgent: boolean;
    out_of_stock: string | null;
}

export default function AdminPage() {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<'staff' | 'tags' | 'orders'>('staff');
    
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
        <div className="flex-1 overflow-y-auto bg-gray-50 p-8">
            <div className="max-w-4xl mx-auto space-y-8">
                <header className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-black uppercase tracking-tighter text-gray-900">Management</h1>
                        <p className="text-[10px] font-bold text-blue-600 uppercase tracking-[0.4em] mt-1">Control Center</p>
                    </div>
                    <div className="flex gap-2 bg-white p-1 rounded-2xl border border-gray-200 shadow-sm">
                        <button
                            onClick={() => setActiveTab('staff')}
                            className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                                activeTab === 'staff' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                            }`}
                        >
                            Staff
                        </button>
                        <button
                            onClick={() => setActiveTab('tags')}
                            className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                                activeTab === 'tags' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                            }`}
                        >
                            Tags
                        </button>
                        <button
                            onClick={() => setActiveTab('orders')}
                            className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                                activeTab === 'orders' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                            }`}
                        >
                            Orders
                        </button>
                    </div>
                </header>

                <div className="grid gap-6">
                    {activeTab === 'staff' ? (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Active Personnel</h2>
                                <button
                                    onClick={() => setIsAddingStaff(true)}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm"
                                >
                                    <Plus className="w-3.5 h-3.5" /> New Staff
                                </button>
                            </div>

                            {isAddingStaff && (
                                <motion.div 
                                    initial={{ opacity: 0, y: -20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="p-6 bg-white rounded-3xl border border-gray-200 shadow-sm space-y-4"
                                >
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black text-gray-600 uppercase px-2 tracking-widest">Full Name</label>
                                            <input
                                                type="text"
                                                value={newStaffName}
                                                onChange={(e) => setNewStaffName(e.target.value)}
                                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-gray-900 font-bold text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                                                placeholder="Enter name..."
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black text-gray-600 uppercase px-2 tracking-widest">Employee ID</label>
                                            <input
                                                type="text"
                                                value={newStaffEmployeeId}
                                                onChange={(e) => setNewStaffEmployeeId(e.target.value)}
                                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-gray-900 font-bold text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                                                placeholder="Enter ID..."
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black text-gray-600 uppercase px-2 tracking-widest">Assign Role</label>
                                        <div className="flex gap-2">
                                            {['technician', 'packer'].map((r) => (
                                                <button
                                                    key={r}
                                                    onClick={() => setNewStaffRole(r as any)}
                                                    className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border ${
                                                        newStaffRole === r ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-gray-50 border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-100'
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
                                            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-sm transition-all"
                                        >
                                            Add Personnel
                                        </button>
                                        <button onClick={() => setIsAddingStaff(false)} className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all">Cancel</button>
                                    </div>
                                </motion.div>
                            )}

                            <div className="grid gap-3">
                                {staff.map((member) => (
                                    <div key={member.id} className={`p-5 rounded-3xl bg-white border border-gray-200 transition-all group hover:shadow-sm ${!member.active && 'opacity-40 grayscale'}`}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-5">
                                                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-sm font-black shadow-sm text-white">
                                                    {member.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="text-base font-black text-gray-900">{member.name}</div>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">{member.role}</span>
                                                        {member.employee_id && <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">• ID: {member.employee_id}</span>}
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => toggleStaffMutation.mutate({ id: member.id, active: !member.active })}
                                                className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                                                    member.active ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                                                }`}
                                            >
                                                {member.active ? 'Disable' : 'Enable'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : activeTab === 'tags' ? (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Task Metadata Tags</h2>
                                <button
                                    onClick={() => setIsAddingTag(true)}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm"
                                >
                                    <Plus className="w-3.5 h-3.5" /> New Tag
                                </button>
                            </div>

                            {isAddingTag && (
                                <motion.div 
                                    initial={{ opacity: 0, y: -20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="p-6 bg-white rounded-3xl border border-gray-200 shadow-sm space-y-5"
                                >
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black text-gray-600 uppercase px-2 tracking-widest">Tag Label</label>
                                        <input
                                            type="text"
                                            value={newTagName}
                                            onChange={(e) => setNewTagName(e.target.value)}
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-gray-900 font-bold text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                                            placeholder="Urgent, Testing, Repair..."
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[9px] font-black text-gray-600 uppercase px-2 tracking-widest">Color ID</label>
                                        <div className="flex gap-3 justify-center bg-gray-50 p-4 rounded-2xl border border-gray-200">
                                            {TAG_COLORS.map((color) => (
                                                <button
                                                    key={color}
                                                    onClick={() => setNewTagColor(color)}
                                                    className={`w-10 h-10 rounded-full ${TAG_COLOR_CLASSES[color as keyof typeof TAG_COLOR_CLASSES]} ${
                                                        newTagColor === color ? 'ring-4 ring-blue-500 scale-110' : 'opacity-50 hover:opacity-80'
                                                    } transition-all shadow-md`}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => newTagName.trim() && createTagMutation.mutate({ name: newTagName, color: newTagColor })}
                                            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-sm transition-all"
                                        >
                                            Generate Tag
                                        </button>
                                        <button onClick={() => setIsAddingTag(false)} className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all">Cancel</button>
                                    </div>
                                </motion.div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                                {tags.map((tag) => (
                                    <div key={tag.id} className="p-4 rounded-2xl bg-white border border-gray-200 flex items-center justify-between group hover:shadow-sm transition-all">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-4 h-4 rounded-full ${TAG_COLOR_CLASSES[tag.color as keyof typeof TAG_COLOR_CLASSES]} shadow-sm ring-2 ring-white`} />
                                            <div className="text-xs font-black uppercase tracking-widest text-gray-900">{tag.name}</div>
                                        </div>
                                        <button
                                            onClick={() => deleteTagMutation.mutate(tag.id)}
                                            className="p-2 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <OrdersManagement />
                    )}
                </div>
            </div>
        </div>
    );
}

// Orders Management Component
function OrdersManagement() {
    const queryClient = useQueryClient();
    const [statusFilter, setStatusFilter] = useState<string>('all');

    // Fetch orders
    const { data: ordersData } = useQuery<{ orders: Order[] }>({
        queryKey: ['orders', statusFilter],
        queryFn: async () => {
            const url = statusFilter === 'all' 
                ? '/api/orders'
                : `/api/orders?status=${statusFilter}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to fetch orders');
            return res.json();
        },
    });

    const orders = ordersData?.orders || [];

    // Assign order mutation
    const assignOrderMutation = useMutation({
        mutationFn: async ({ orderId, assignedTo, urgent, shipByDate, outOfStock }: { orderId: number; assignedTo?: string; urgent?: boolean; shipByDate?: string; outOfStock?: string }) => {
            const res = await fetch('/api/orders/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId, assignedTo, urgent, shipByDate, outOfStock }),
            });
            if (!res.ok) throw new Error('Failed to assign order');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
        },
    });

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Order Assignment</h2>
                
                {/* Status Filter */}
                <div className="flex gap-2">
                    {['all', 'unassigned', 'assigned', 'in_progress', 'missing_parts'].map((status) => (
                        <button
                            key={status}
                            onClick={() => setStatusFilter(status)}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                                statusFilter === status
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            {(status ?? '').replace('_', ' ')}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid gap-3">
                {orders.length === 0 ? (
                    <div className="p-8 text-center bg-white rounded-3xl border border-gray-200">
                        <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">
                            No orders found
                        </p>
                    </div>
                ) : (
                    orders.map((order) => (
                        <div key={order.id} className="p-5 rounded-3xl bg-white border border-gray-200 transition-all hover:shadow-sm">
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h3 className="text-base font-black text-gray-900">
                                            {order.product_title}
                                        </h3>
                                        {order.urgent && (
                                            <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[8px] font-black uppercase rounded">
                                                Urgent
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 text-[9px] font-bold text-gray-500 uppercase tracking-widest">
                                        <span>Order: {order.order_id}</span>
                                        <span>•</span>
                                        <span>SKU: {order.sku}</span>
                                        {order.ship_by_date && (
                                            <>
                                                <span>•</span>
                                                <span>Ship By: {order.ship_by_date}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                
                                <div className="flex flex-col gap-2">
                                    <span className={`px-3 py-1 rounded-xl text-[8px] font-black uppercase tracking-widest ${
                                        order.status === 'unassigned' ? 'bg-gray-100 text-gray-600' :
                                        order.status === 'assigned' ? 'bg-blue-100 text-blue-700' :
                                        order.status === 'in_progress' ? 'bg-emerald-100 text-emerald-700' :
                                        'bg-amber-100 text-amber-700'
                                    }`}>
                                        {order.status === 'missing_parts' && order.out_of_stock ? order.out_of_stock : (order.status ?? '').replace('_', ' ')}
                                    </span>
                                </div>
                            </div>

                            {order.status === 'missing_parts' && (
                                <div className="absolute top-4 right-4">
                                    <button
                                        onClick={() => {
                                            const currentVal = order.out_of_stock || '';
                                            const newVal = currentVal.startsWith('ordered:') 
                                                ? currentVal.replace('ordered:', '').trim()
                                                : `ordered: ${currentVal}`;
                                            assignOrderMutation.mutate({ 
                                                orderId: order.id, 
                                                outOfStock: newVal
                                            });
                                        }}
                                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                                            order.out_of_stock?.startsWith('ordered:')
                                                ? 'bg-emerald-500 text-white shadow-lg'
                                                : 'bg-gray-100 text-gray-400 border border-gray-200 hover:border-emerald-300 hover:text-emerald-500'
                                        }`}
                                        title={order.out_of_stock?.startsWith('ordered:') ? 'Part Ordered' : 'Mark as Ordered'}
                                    >
                                        <Check className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            )}

                            <div className="flex items-center gap-3">
                                {/* Assign to Technician - Quick Buttons */}
                                <div className="flex-1 flex gap-2">
                                    {[
                                        { id: 'Tech_1', label: 'Michael' },
                                        { id: 'Tech_2', label: 'Thuc' },
                                        { id: 'Tech_3', label: 'Sang' }
                                    ].map((tech) => (
                                        <button
                                            key={tech.id}
                                            onClick={() => assignOrderMutation.mutate({ 
                                                orderId: order.id, 
                                                assignedTo: order.assigned_to === tech.id ? '' : tech.id 
                                            })}
                                            className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${
                                                order.assigned_to === tech.id
                                                    ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                                                    : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
                                            }`}
                                        >
                                            {tech.label}
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => assignOrderMutation.mutate({ 
                                            orderId: order.id, 
                                            assignedTo: '' 
                                        })}
                                        className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${
                                            !order.assigned_to
                                                ? 'bg-gray-200 border-gray-300 text-gray-700'
                                                : 'bg-white border-gray-200 text-gray-400 hover:bg-gray-50'
                                        }`}
                                        title="Unassign"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>

                                {/* Toggle Urgent */}
                                <button
                                    onClick={() => assignOrderMutation.mutate({ 
                                        orderId: order.id, 
                                        urgent: !order.urgent 
                                    })}
                                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                                        order.urgent
                                            ? 'bg-red-600 text-white'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                >
                                    {order.urgent ? '! Urgent' : 'Mark Urgent'}
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
