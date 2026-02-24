'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, AlertCircle, ExternalLink } from '@/components/Icons';
import { motion } from 'framer-motion';
import { SearchBar } from '@/components/ui/SearchBar';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { PlatformExternalChip } from '@/components/ui/PlatformExternalChip';
import { AdminDetailsStack } from '@/components/shipped/stacks/adminDetailsStack';
import { getOrderPlatformLabel } from '@/utils/order-platform';
import { getOrderIdUrl, getTrackingUrl } from '@/utils/order-links';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { DaysLateBadge } from '@/components/ui/DaysLateBadge';
import EbayManagement from '@/components/EbayManagement';

interface Staff {
    id: number;
    name: string;
    role: string;
    employee_id: string | null;
    source_table: string | null;
    active: boolean;
    created_at?: string | null;
}

interface Order {
    id: number;
    ship_by_date: string | null;
    order_id: string;
    product_title: string;
    quantity?: string | number | null;
    item_number?: string | null;
    account_source?: string | null;
    sku: string;
    shipping_tracking_number: string | null;
    tester_id: number | null;
    packer_id: number | null;
    out_of_stock: string | null;
    notes: string | null;
    is_shipped: boolean;
    created_at: string | null;
}

export default function AdminPage() {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<'staff' | 'orders' | 'connections'>('orders');
    
    // Staff state
    const [isAddingStaff, setIsAddingStaff] = useState(false);
    // ... rest of state ...
    const [newStaffName, setNewStaffName] = useState('');
    const [newStaffRole, setNewStaffRole] = useState<'technician' | 'packer'>('technician');
    const [newStaffEmployeeId, setNewStaffEmployeeId] = useState('');
    const [newStaffSourceTable, setNewStaffSourceTable] = useState('');
    const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editRole, setEditRole] = useState<'technician' | 'packer'>('technician');
    const [editEmployeeId, setEditEmployeeId] = useState('');
    const [editSourceTable, setEditSourceTable] = useState('');
    const [editActive, setEditActive] = useState(true);

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
        mutationFn: async (data: { name: string; role: string; employee_id: string; source_table: string; active: boolean }) => {
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
            setNewStaffSourceTable('');
            setNewStaffRole('technician');
        },
    });

    const updateStaffMutation = useMutation({
        mutationFn: async (data: {
            id: number;
            name?: string;
            role?: string;
            employee_id?: string;
            source_table?: string;
            active?: boolean;
        }) => {
            const res = await fetch('/api/staff', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error('Failed to update staff');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['staff'] });
            setEditingStaffId(null);
        },
    });

    const deleteStaffMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await fetch(`/api/staff?id=${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete staff');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['staff'] });
            setEditingStaffId(null);
        },
    });

    const startEditStaff = (member: Staff) => {
        setEditingStaffId(member.id);
        setEditName(member.name || '');
        setEditRole((member.role as 'technician' | 'packer') || 'technician');
        setEditEmployeeId(member.employee_id || '');
        setEditSourceTable(member.source_table || '');
        setEditActive(Boolean(member.active));
    };

    return (
        <div className="flex-1 overflow-y-auto bg-gray-50 relative">
            <div className="max-w-4xl mx-auto p-8 space-y-8">
                <header className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-black uppercase tracking-tighter text-gray-900">Management</h1>
                        <p className="text-[10px] font-bold text-blue-600 uppercase tracking-[0.4em] mt-1">Control Center</p>
                    </div>
                    <div className="flex gap-2 bg-white p-1 rounded-2xl border border-gray-200 shadow-sm">
                        <button
                            onClick={() => setActiveTab('orders')}
                            className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                                activeTab === 'orders' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                            }`}
                        >
                            Orders
                        </button>
                        <button
                            onClick={() => setActiveTab('staff')}
                            className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                                activeTab === 'staff' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                            }`}
                        >
                            Staff
                        </button>
                        <button
                            onClick={() => setActiveTab('connections')}
                            className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                                activeTab === 'connections' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                            }`}
                        >
                            Connections
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
                                        <label className="text-[9px] font-black text-gray-600 uppercase px-2 tracking-widest">Source Table</label>
                                        <input
                                            type="text"
                                            value={newStaffSourceTable}
                                            onChange={(e) => setNewStaffSourceTable(e.target.value)}
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-gray-900 font-bold text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                                            placeholder="tech_1, tech_2, packer_1..."
                                        />
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
                                            onClick={() => newStaffName.trim() && createStaffMutation.mutate({
                                                name: newStaffName,
                                                role: newStaffRole,
                                                employee_id: newStaffEmployeeId,
                                                source_table: newStaffSourceTable,
                                                active: true,
                                            })}
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
                                        {editingStaffId === member.id ? (
                                            <div className="space-y-3">
                                                <div className="grid grid-cols-2 gap-3">
                                                    <input
                                                        type="text"
                                                        value={editName}
                                                        onChange={(e) => setEditName(e.target.value)}
                                                        className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                                                        placeholder="Full Name"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={editEmployeeId}
                                                        onChange={(e) => setEditEmployeeId(e.target.value)}
                                                        className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                                                        placeholder="Employee ID"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <select
                                                        value={editRole}
                                                        onChange={(e) => setEditRole(e.target.value as 'technician' | 'packer')}
                                                        className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                                                    >
                                                        <option value="technician">technician</option>
                                                        <option value="packer">packer</option>
                                                    </select>
                                                    <input
                                                        type="text"
                                                        value={editSourceTable}
                                                        onChange={(e) => setEditSourceTable(e.target.value)}
                                                        className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                                                        placeholder="source_table"
                                                    />
                                                </div>
                                                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-600">
                                                    <input
                                                        type="checkbox"
                                                        checked={editActive}
                                                        onChange={(e) => setEditActive(e.target.checked)}
                                                        className="h-4 w-4 rounded border-gray-300 text-blue-600"
                                                    />
                                                    Active
                                                </label>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => updateStaffMutation.mutate({
                                                            id: member.id,
                                                            name: editName.trim(),
                                                            role: editRole,
                                                            employee_id: editEmployeeId,
                                                            source_table: editSourceTable,
                                                            active: editActive,
                                                        })}
                                                        className="flex-1 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-widest"
                                                    >
                                                        Save
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingStaffId(null)}
                                                        className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-[10px] font-black uppercase tracking-widest"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        onClick={() => deleteStaffMutation.mutate(member.id)}
                                                        className="px-4 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-black uppercase tracking-widest border border-red-200"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-5">
                                                    <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-sm font-black shadow-sm text-blue-600 border border-blue-100">
                                                        {member.name.substring(0, 2).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div className="text-base font-black text-gray-900">{member.name}</div>
                                                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                            <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">{member.role}</span>
                                                            {member.employee_id && <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">• ID: {member.employee_id}</span>}
                                                            {member.source_table && <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">• SRC: {member.source_table}</span>}
                                                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">• {member.active ? 'Active' : 'Inactive'}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => startEditStaff(member)}
                                                        className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-blue-200 text-blue-600 hover:bg-blue-50 transition-all"
                                                    >
                                                        Edit
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : activeTab === 'connections' ? (
                        <ConnectionsManagement />
                    ) : (
                        <OrdersManagement />
                    )}
                </div>
            </div>
        </div>
    );
}

function ConnectionsManagement() {
    const ebayBackfillMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/orders/backfill/ebay', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lookbackDays: 30, limitPerAccount: 200 }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || data?.message || `Backfill failed (HTTP ${res.status})`);
            }
            return data;
        },
    });
    const ecwidBackfillMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/orders/backfill/ecwid', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ maxPages: 10 }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || data?.message || `Backfill failed (HTTP ${res.status})`);
            }
            return data;
        },
    });
    const ecwidSquareSyncMutation = useMutation({
        mutationFn: async ({ dryRun = false, batchSize }: { dryRun?: boolean; batchSize?: number }) => {
            const res = await fetch('/api/ecwid-square/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dryRun, batchSize }),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || data?.message || `Sync failed (HTTP ${res.status})`);
            }

            return data;
        },
    });
    const exceptionsSyncMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/orders-exceptions/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || data?.message || `Sync failed (HTTP ${res.status})`);
            }
            return data;
        },
    });

    const counts = ecwidSquareSyncMutation.data?.counts;

    return (
        <div className="space-y-6">
            <div className="space-y-4 p-5 bg-white rounded-3xl border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">
                            Orders Integrity Backfill
                        </h2>
                        <p className="text-[9px] font-bold text-gray-500 mt-1">
                            Backfill only empty columns in orders table from marketplace APIs
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => ebayBackfillMutation.mutate()}
                            disabled={ebayBackfillMutation.isPending}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${ebayBackfillMutation.isPending ? 'animate-spin' : ''}`} />
                            {ebayBackfillMutation.isPending ? 'Backfilling...' : 'Backfill eBay'}
                        </button>
                        <button
                            onClick={() => ecwidBackfillMutation.mutate()}
                            disabled={ecwidBackfillMutation.isPending}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${ecwidBackfillMutation.isPending ? 'animate-spin' : ''}`} />
                            {ecwidBackfillMutation.isPending ? 'Backfilling...' : 'Backfill Ecwid'}
                        </button>
                    </div>
                </div>

                {ebayBackfillMutation.isSuccess && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-green-50 border border-green-200 rounded-2xl"
                    >
                        <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
                            eBay: Updated {ebayBackfillMutation.data?.totals?.updated || 0} • Matched {ebayBackfillMutation.data?.totals?.matched || 0} • Unmatched {ebayBackfillMutation.data?.totals?.unmatched || 0}
                        </div>
                    </motion.div>
                )}

                {ebayBackfillMutation.isError && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-red-50 border border-red-200 rounded-2xl"
                    >
                        <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">
                            {(ebayBackfillMutation.error as Error)?.message || 'eBay backfill failed'}
                        </div>
                    </motion.div>
                )}

                {ecwidBackfillMutation.isSuccess && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-green-50 border border-green-200 rounded-2xl"
                    >
                        <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
                            Ecwid: Updated {ecwidBackfillMutation.data?.totals?.updated || 0} • Matched {ecwidBackfillMutation.data?.totals?.matched || 0} • Unmatched {ecwidBackfillMutation.data?.totals?.unmatched || 0}
                        </div>
                    </motion.div>
                )}

                {ecwidBackfillMutation.isError && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-red-50 border border-red-200 rounded-2xl"
                    >
                        <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">
                            {(ecwidBackfillMutation.error as Error)?.message || 'Ecwid backfill failed'}
                        </div>
                    </motion.div>
                )}
            </div>

            <div className="space-y-4 p-5 bg-white rounded-3xl border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">
                            Ecwid → Square Catalog
                        </h2>
                        <p className="text-[9px] font-bold text-gray-500 mt-1">
                            One-way sync for enabled Ecwid products only
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => ecwidSquareSyncMutation.mutate({ dryRun: true })}
                            disabled={ecwidSquareSyncMutation.isPending}
                            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-gray-700 disabled:opacity-50"
                        >
                            Dry Run
                        </button>
                        <button
                            onClick={() => ecwidSquareSyncMutation.mutate({ dryRun: false, batchSize: 200 })}
                            disabled={ecwidSquareSyncMutation.isPending}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${ecwidSquareSyncMutation.isPending ? 'animate-spin' : ''}`} />
                            {ecwidSquareSyncMutation.isPending ? 'Syncing...' : 'Sync Now'}
                        </button>
                    </div>
                </div>

                {ecwidSquareSyncMutation.isSuccess && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-green-50 border border-green-200 rounded-2xl space-y-2"
                    >
                        <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
                            {ecwidSquareSyncMutation.data?.dryRun ? 'Dry run completed' : 'Sync completed'}
                        </div>
                        {counts && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[9px] font-bold text-green-800 uppercase tracking-wide">
                                <div>Ecwid total: {counts.ecwidTotal}</div>
                                <div>Enabled: {counts.ecwidEnabled}</div>
                                <div>Skipped disabled: {counts.skippedDisabled}</div>
                                <div>Square upserts: {counts.upsertedObjectCount}</div>
                            </div>
                        )}
                        {typeof ecwidSquareSyncMutation.data?.batchSizeUsed === 'number' && (
                            <div className="text-[9px] font-bold text-green-800 uppercase tracking-wide">
                                Batch size used: {ecwidSquareSyncMutation.data.batchSizeUsed}
                            </div>
                        )}
                    </motion.div>
                )}

                {ecwidSquareSyncMutation.isError && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-red-50 border border-red-200 rounded-2xl"
                    >
                        <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">
                            {(ecwidSquareSyncMutation.error as Error)?.message || 'Sync failed'}
                        </div>
                    </motion.div>
                )}
            </div>

            <div className="space-y-4 p-5 bg-white rounded-3xl border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">
                            Orders Exceptions Integrity
                        </h2>
                        <p className="text-[9px] font-bold text-gray-500 mt-1">
                            Match exceptions to orders by shipping tracking and clear resolved exceptions
                        </p>
                    </div>
                    <button
                        onClick={() => exceptionsSyncMutation.mutate()}
                        disabled={exceptionsSyncMutation.isPending}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${exceptionsSyncMutation.isPending ? 'animate-spin' : ''}`} />
                        {exceptionsSyncMutation.isPending ? 'Checking...' : 'Sync Exceptions'}
                    </button>
                </div>

                {exceptionsSyncMutation.isSuccess && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-green-50 border border-green-200 rounded-2xl"
                    >
                        <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
                            Scanned: {exceptionsSyncMutation.data?.scanned || 0} • Matched: {exceptionsSyncMutation.data?.matched || 0} • Cleared: {exceptionsSyncMutation.data?.deleted || 0}
                        </div>
                    </motion.div>
                )}

                {exceptionsSyncMutation.isError && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-red-50 border border-red-200 rounded-2xl"
                    >
                        <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">
                            {(exceptionsSyncMutation.error as Error)?.message || 'Exceptions sync failed'}
                        </div>
                    </motion.div>
                )}
            </div>

            <EbayManagement />
        </div>
    );
}

// Orders Management Component
function OrdersManagement() {
    const queryClient = useQueryClient();
    const [filterTab, setFilterTab] = useState<'all' | 'unassigned' | 'assigned' | 'out of stock'>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([]);
    const [focusedOrderId, setFocusedOrderId] = useState<number | null>(null);
    const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
    const [bulkTesterId, setBulkTesterId] = useState<number | null>(null);
    const [bulkPackerId, setBulkPackerId] = useState<number | null>(null);
    const appliedOrderParamRef = useRef(false);
    const { getExternalUrlByItemNumber, openExternalByItemNumber } = useExternalItemUrl();

    // Fetch orders
    const { data: ordersData } = useQuery<{ orders: Order[] }>({
        queryKey: ['orders'],
        queryFn: async () => {
            const res = await fetch('/api/orders');
            if (!res.ok) throw new Error('Failed to fetch orders');
            return res.json();
        },
    });

    const allOrders = ordersData?.orders || [];

    const { data: activeStaff = [] } = useQuery<Staff[]>({
        queryKey: ['staff', 'admin-orders-active'],
        queryFn: async () => {
            const res = await fetch('/api/staff?active=true');
            if (!res.ok) throw new Error('Failed to fetch staff');
            return res.json();
        },
    });
    
    // Apply filtering
    const orders = allOrders.filter(order => {
        if (order.is_shipped) return false;
        const normalizedSearchTerm = searchTerm.toLowerCase();
        // Filter by tab
        const matchesTab = (() => {
            if (filterTab === 'out of stock') return order.out_of_stock && (order.is_shipped === false || !order.is_shipped);
            if (filterTab === 'unassigned') return order.packer_id == null && order.tester_id == null;
            if (filterTab === 'assigned') return order.packer_id != null || order.tester_id != null;
            return true;
        })();

        // Filter by search (fuzzy search on product_title)
        const matchesSearch = String(order.product_title || '').toLowerCase().includes(normalizedSearchTerm) ||
                             String(order.sku || '').toLowerCase().includes(normalizedSearchTerm) ||
                             String(order.order_id || '').toLowerCase().includes(normalizedSearchTerm);

        return matchesTab && matchesSearch;
    });

    const testerOptions = activeStaff
        .filter((member) => member.role === 'technician')
        .map((member) => ({ id: member.id, name: member.name }));
    const packerOptions = activeStaff
        .filter((member) => member.role === 'packer')
        .map((member) => ({ id: member.id, name: member.name }));

    const getStaffNameById = (id: number | null | undefined) => {
        if (!id) return null;
        return activeStaff.find((member) => member.id === id)?.name || null;
    };

    const bulkAssignMutation = useMutation({
        mutationFn: async ({
            orderIds,
            testerId,
            packerId,
        }: {
            orderIds: number[];
            testerId: number | null;
            packerId: number | null;
        }) => {
            const payload: any = { orderIds };
            if (testerId !== null) payload.testerId = testerId;
            if (packerId !== null) payload.packerId = packerId;

            const res = await fetch('/api/orders/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                throw new Error('Failed to bulk assign orders');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            setBulkTesterId(null);
            setBulkPackerId(null);
        },
    });
    const rowAssignMutation = useMutation({
        mutationFn: async (payload: { orderId: number; testerId?: number | null; packerId?: number | null }) => {
            const res = await fetch('/api/orders/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error('Failed to update assignment');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
        },
    });

    useEffect(() => {
        if (allOrders.length === 0) return;
        const idsInData = new Set(allOrders.map((order) => order.id));
        setSelectedOrderIds((current) => current.filter((id) => idsInData.has(id)));
        setFocusedOrderId((current) => (current && idsInData.has(current) ? current : null));
    }, [allOrders]);

    useEffect(() => {
        if (appliedOrderParamRef.current) return;
        if (typeof window === 'undefined') return;
        const orderParam = Number(new URLSearchParams(window.location.search).get('orderId'));
        if (!orderParam || Number.isNaN(orderParam) || allOrders.length === 0) return;

        const match = allOrders.find((order) => order.id === orderParam);
        if (!match) return;

        appliedOrderParamRef.current = true;
        setFocusedOrderId(match.id);
        setSelectedOrderIds((current) => (current.includes(match.id) ? current : [...current, match.id]));
        setIsDetailsPanelOpen(true);
    }, [allOrders]);

    const selectedOrder = allOrders.find((order) => order.id === focusedOrderId) || null;

    const toggleSelectOrder = (orderId: number) => {
        setSelectedOrderIds((current) =>
            current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId]
        );
    };

    const handleApplyBulk = async () => {
        if (selectedOrderIds.length === 0) return;
        if (bulkTesterId === null && bulkPackerId === null) return;
        await bulkAssignMutation.mutateAsync({
            orderIds: selectedOrderIds,
            testerId: bulkTesterId,
            packerId: bulkPackerId,
        });
        setSelectedOrderIds([]);
        setFocusedOrderId(null);
        setIsDetailsPanelOpen(false);
    };

    const getOrderIdLast4 = (orderId: string) => {
        const digits = String(orderId || '').replace(/\D/g, '');
        if (digits.length >= 4) return digits.slice(-4);
        return String(orderId || '').slice(-4);
    };

    const getTrackingLast4 = (tracking: string | null) => {
        const raw = String(tracking || '');
        return raw.length > 4 ? raw.slice(-4) : raw || '---';
    };

    const getDisplayShipByDate = (order: Order) => {
        const shipByRaw = String(order.ship_by_date || '').trim();
        const createdAtRaw = String(order.created_at || '').trim();
        const isInvalidShipBy =
            !shipByRaw ||
            /^\d+$/.test(shipByRaw) ||
            Number.isNaN(new Date(shipByRaw).getTime());
        if (isInvalidShipBy) return createdAtRaw || null;
        return shipByRaw;
    };

    return (
        <div className="flex flex-col lg:flex-row items-start gap-4">
            <div className="flex-1 space-y-4 min-w-0">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                    <SearchBar
                        value={searchTerm}
                        onChange={setSearchTerm}
                        placeholder="Search product title, SKU, or Order ID..."
                        className="flex-1 max-w-md w-full"
                    />

                    <div className="flex gap-2 p-1 bg-white rounded-2xl border border-gray-200 shadow-sm w-fit">
                        {(['all', 'unassigned', 'assigned', 'out of stock'] as const).map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setFilterTab(tab)}
                                className={`px-4 py-1.5 rounded-xl font-black text-[9px] uppercase tracking-wider transition-all ${
                                    filterTab === tab
                                        ? tab === 'out of stock'
                                            ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                                            : tab === 'unassigned'
                                                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                                                : tab === 'assigned'
                                                    ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/20'
                                                : 'bg-blue-600 text-white shadow-md'
                                        : 'text-gray-400 hover:text-gray-900 hover:bg-gray-50'
                                }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex flex-wrap justify-between items-center gap-3 bg-white p-4 rounded-3xl border border-gray-200 shadow-sm">
                    <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Order Management</h2>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-600">
                            {orders.length} shown • {selectedOrderIds.length} selected
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                setSelectedOrderIds([]);
                                setFocusedOrderId(null);
                            }}
                            disabled={selectedOrderIds.length === 0}
                            className="px-3 py-1.5 rounded-xl border border-gray-200 text-[9px] font-black uppercase tracking-widest text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                            Unselect All
                        </button>
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
                        orders.map((order) => {
                            const isSelected = selectedOrderIds.includes(order.id);
                            const isFocused = focusedOrderId === order.id;
                            const platformLabel = getOrderPlatformLabel(order.order_id, order.account_source) || 'UNKNOWN';
                            const isEbayOrder = platformLabel.toLowerCase().includes('ebay');
                            const orderUrl = getOrderIdUrl(order.order_id);
                            const productPageUrl = getExternalUrlByItemNumber(order.item_number || null);

                            return (
                                <button
                                    key={order.id}
                                    type="button"
                                    onClick={() => {
                                        setFocusedOrderId(order.id);
                                        setIsDetailsPanelOpen(true);
                                    }}
                                    className={`text-left bg-white border hover:shadow-sm p-5 rounded-3xl transition-all ${
                                        isSelected
                                            ? 'border-blue-300 ring-2 ring-blue-100'
                                            : 'border-gray-200'
                                    } ${isFocused ? 'shadow-sm' : ''}`}
                                >
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleSelectOrder(order.id)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                />
                                                <ShipByDate
                                                    date={getDisplayShipByDate(order) || ''}
                                                    className="h-9 px-3 rounded-lg bg-blue-50 border border-blue-100"
                                                />
                                                <DaysLateBadge
                                                    shipByDate={order.ship_by_date}
                                                    fallbackDate={order.created_at}
                                                    variant="full"
                                                    className="h-9 rounded-lg"
                                                />
                                                <span className="inline-flex items-center h-9 px-3 rounded-lg bg-gray-100 border border-gray-200 text-[10px] font-black text-gray-800">
                                                    Qty:{Math.max(1, parseInt(String(order.quantity ?? '1'), 10) || 1)}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                <PlatformExternalChip
                                                    orderId={order.order_id}
                                                    accountSource={order.account_source}
                                                    canOpen={!!productPageUrl}
                                                    onOpen={() => openExternalByItemNumber(order.item_number || null)}
                                                />

                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const value = order.shipping_tracking_number || '';
                                                        if (value) navigator.clipboard.writeText(value);
                                                    }}
                                                    className="inline-flex items-center h-9 gap-1.5 px-3 rounded-lg bg-blue-50 border border-blue-100 text-[10px] font-black text-blue-700"
                                                    title="Click to copy tracking number"
                                                >
                                                    <span className="text-[8px] text-blue-400 uppercase">Tracking</span>
                                                    <span className="font-mono">{getTrackingLast4(order.shipping_tracking_number)}</span>
                                                    {getTrackingUrl(order.shipping_tracking_number || '') && (
                                                        <span
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const url = getTrackingUrl(order.shipping_tracking_number || '');
                                                                if (url) window.open(url, '_blank', 'noopener,noreferrer');
                                                            }}
                                                            className="inline-flex items-center justify-center"
                                                            title="Open tracking in external page"
                                                            aria-label="Open tracking in external page"
                                                        >
                                                            <ExternalLink className="w-3 h-3 text-blue-600" />
                                                        </span>
                                                    )}
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const value = order.order_id || '';
                                                        if (value) navigator.clipboard.writeText(value);
                                                    }}
                                                    className="inline-flex items-center h-9 gap-1.5 px-3 rounded-lg bg-gray-50 border border-gray-100 text-[10px] font-black text-gray-800"
                                                    title="Click to copy order ID"
                                                >
                                                    <span className="text-[8px] text-gray-400 uppercase">Order</span>
                                                    <span className="font-mono">#{getOrderIdLast4(order.order_id)}</span>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (orderUrl && !isEbayOrder) {
                                                                window.open(orderUrl, '_blank', 'noopener,noreferrer');
                                                            }
                                                        }}
                                                        disabled={isEbayOrder || !orderUrl}
                                                        className="inline-flex items-center justify-center text-blue-600 disabled:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
                                                        title={isEbayOrder ? 'Order page link disabled for eBay orders' : (/^\d{3}-\d+-\d+$/.test(order.order_id) ? 'Open Amazon order in Seller Central in new tab' : 'Open Ecwid order in new tab')}
                                                        aria-label={isEbayOrder ? 'Order page link disabled for eBay orders' : 'Open order in external page'}
                                                    >
                                                        <span
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                            }}
                                                            className="inline-flex items-center justify-center"
                                                        >
                                                            <ExternalLink className="w-3 h-3" />
                                                        </span>
                                                    </button>
                                                </button>

                                            </div>
                                        </div>

                                        {order.out_of_stock && filterTab === 'out of stock' && (
                                            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-500 text-white rounded shadow-sm w-fit">
                                                <AlertCircle className="w-3 h-3" />
                                                <span className="text-[8px] font-black uppercase tracking-wider">Out of Stock</span>
                                            </div>
                                        )}

                                        <h3 className="text-base font-black text-gray-900 leading-tight">{order.product_title}</h3>

                                        <div className="grid grid-cols-2 gap-3" onClick={(e) => e.stopPropagation()}>
                                            <div className="bg-gray-50 rounded-xl border border-gray-100 flex items-center gap-2">
                                                <p className="text-[9px] font-black text-gray-700 uppercase tracking-wider whitespace-nowrap pl-3">
                                                    Tester
                                                </p>
                                                <select
                                                    value={order.tester_id ?? ''}
                                                    onChange={(e) => {
                                                        const value = e.target.value;
                                                        rowAssignMutation.mutate({
                                                            orderId: order.id,
                                                            testerId: value === '' ? null : Number(value),
                                                        });
                                                    }}
                                                    className="flex-1 h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-black text-gray-800 outline-none focus:border-blue-500"
                                                >
                                                    <option value="">Unassigned</option>
                                                    {testerOptions.map((member) => (
                                                        <option key={member.id} value={member.id}>
                                                            {member.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="bg-gray-50 rounded-xl border border-gray-100 flex items-center gap-2">
                                                <p className="text-[9px] font-black text-gray-700 uppercase tracking-wider whitespace-nowrap pl-3">
                                                    Packer
                                                </p>
                                                <select
                                                    value={order.packer_id ?? ''}
                                                    onChange={(e) => {
                                                        const value = e.target.value;
                                                        rowAssignMutation.mutate({
                                                            orderId: order.id,
                                                            packerId: value === '' ? null : Number(value),
                                                        });
                                                    }}
                                                    className="flex-1 h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-black text-gray-800 outline-none focus:border-blue-500"
                                                >
                                                    <option value="">Unassigned</option>
                                                    {packerOptions.map((member) => (
                                                        <option key={member.id} value={member.id}>
                                                            {member.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
            {isDetailsPanelOpen && (
                <AdminDetailsStack
                    order={selectedOrder}
                    selectedCount={selectedOrderIds.length}
                    testerOptions={testerOptions}
                    packerOptions={packerOptions}
                    testerName={getStaffNameById(selectedOrder?.tester_id)}
                    packerName={getStaffNameById(selectedOrder?.packer_id)}
                    bulkTesterId={bulkTesterId}
                    bulkPackerId={bulkPackerId}
                    onBulkTesterChange={setBulkTesterId}
                    onBulkPackerChange={setBulkPackerId}
                    onApplyBulk={handleApplyBulk}
                    isApplyingBulk={bulkAssignMutation.isPending}
                    onClose={() => {
                        setIsDetailsPanelOpen(false);
                        setFocusedOrderId(null);
                    }}
                    onOrderUpdated={() => {
                        queryClient.invalidateQueries({ queryKey: ['orders'] });
                    }}
                />
            )}
        </div>
    );
}
