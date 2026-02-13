'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw } from '@/components/Icons';
import { motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { SearchBar } from '@/components/ui/SearchBar';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { AdminDetailsStack } from '@/components/shipped/stacks/adminDetailsStack';

interface Staff {
    id: number;
    name: string;
    role: string;
    employee_id: string | null;
    active: boolean;
}

interface Order {
    id: number;
    ship_by_date: string | null;
    order_id: string;
    product_title: string;
    sku: string;
    shipping_tracking_number: string | null;
    tester_id: number | null;
    packer_id: number | null;
    out_of_stock: string | null;
    notes: string | null;
    is_shipped: boolean;
    created_at: string | null;
}

interface EbayAccount {
    id: number;
    account_name: string;
    last_sync_date: string | null;
    is_active: boolean;
    token_expires_at: string;
}

export default function AdminPage() {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<'staff' | 'orders'>('orders');
    
    // Staff state
    const [isAddingStaff, setIsAddingStaff] = useState(false);
    // ... rest of state ...
    const [newStaffName, setNewStaffName] = useState('');
    const [newStaffRole, setNewStaffRole] = useState<'technician' | 'packer'>('technician');
    const [newStaffEmployeeId, setNewStaffEmployeeId] = useState('');

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
                                                <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-sm font-black shadow-sm text-blue-600 border border-blue-100">
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
    const searchParams = useSearchParams();
    const [filterTab, setFilterTab] = useState<'out of stock' | 'all'>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([]);
    const [focusedOrderId, setFocusedOrderId] = useState<number | null>(null);
    const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
    const [bulkTesterId, setBulkTesterId] = useState<number | null>(null);
    const [bulkPackerId, setBulkPackerId] = useState<number | null>(null);
    const appliedOrderParamRef = useRef(false);

    // Fetch eBay accounts
    const { data: accountsData } = useQuery({
        queryKey: ['ebay-accounts'],
        queryFn: async () => {
            const res = await fetch('/api/ebay/accounts');
            if (!res.ok) throw new Error('Failed to fetch accounts');
            return res.json();
        },
    });

    // eBay sync mutation
    const ebaySyncMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/ebay/sync', { method: 'POST' });
            if (!res.ok) throw new Error('Failed to sync');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['ebay-accounts'] });
        },
    });

    // Token refresh mutation
    const refreshTokenMutation = useMutation({
        mutationFn: async (accountName: string) => {
            const res = await fetch('/api/ebay/refresh-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountName }),
            });
            if (!res.ok) throw new Error('Failed to refresh token');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ebay-accounts'] });
        },
    });

    const accounts: EbayAccount[] = accountsData?.accounts || [];

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
        // Filter by tab
        const matchesTab = (() => {
            if (filterTab === 'out of stock') return order.out_of_stock && (order.is_shipped === false || !order.is_shipped);
            return true;
        })();

        // Filter by search (fuzzy search on product_title)
        const matchesSearch = order.product_title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                             order.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
                             order.order_id.toLowerCase().includes(searchTerm.toLowerCase());

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

    useEffect(() => {
        if (allOrders.length === 0) return;
        const idsInData = new Set(allOrders.map((order) => order.id));
        setSelectedOrderIds((current) => current.filter((id) => idsInData.has(id)));
        setFocusedOrderId((current) => (current && idsInData.has(current) ? current : null));
    }, [allOrders]);

    useEffect(() => {
        if (appliedOrderParamRef.current) return;
        const orderParam = Number(searchParams.get('orderId'));
        if (!orderParam || Number.isNaN(orderParam) || allOrders.length === 0) return;

        const match = allOrders.find((order) => order.id === orderParam);
        if (!match) return;

        appliedOrderParamRef.current = true;
        setFocusedOrderId(match.id);
        setSelectedOrderIds((current) => (current.includes(match.id) ? current : [...current, match.id]));
        setIsDetailsPanelOpen(true);
    }, [searchParams, allOrders]);

    const selectedOrder = allOrders.find((order) => order.id === focusedOrderId) || null;
    const allVisibleSelected = orders.length > 0 && orders.every((order) => selectedOrderIds.includes(order.id));

    const toggleSelectOrder = (orderId: number) => {
        setSelectedOrderIds((current) =>
            current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId]
        );
    };

    const toggleSelectAllVisible = () => {
        if (allVisibleSelected) {
            const visibleIds = new Set(orders.map((order) => order.id));
            setSelectedOrderIds((current) => current.filter((id) => !visibleIds.has(id)));
            return;
        }
        const next = new Set(selectedOrderIds);
        orders.forEach((order) => next.add(order.id));
        setSelectedOrderIds(Array.from(next));
    };

    const handleApplyBulk = async () => {
        if (selectedOrderIds.length === 0) return;
        if (bulkTesterId === null && bulkPackerId === null) return;
        await bulkAssignMutation.mutateAsync({
            orderIds: selectedOrderIds,
            testerId: bulkTesterId,
            packerId: bulkPackerId,
        });
    };

    return (
        <div className="flex flex-col lg:flex-row items-start gap-4">
            <div className="flex-1 space-y-4 min-w-0">
                {/* eBay Management Section */}
                <div className="space-y-4 p-5 bg-white rounded-3xl border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">
                                eBay Integration
                            </h2>
                            <p className="text-[9px] font-bold text-gray-500 mt-1">
                                Multi-account order synchronization
                            </p>
                        </div>
                        <button
                            onClick={() => ebaySyncMutation.mutate()}
                            disabled={ebaySyncMutation.isPending}
                            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${ebaySyncMutation.isPending ? 'animate-spin' : ''}`} />
                            {ebaySyncMutation.isPending ? 'Syncing...' : 'Sync eBay'}
                        </button>
                    </div>

                    {ebaySyncMutation.isSuccess && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-4 bg-green-50 border border-green-200 rounded-2xl"
                        >
                            <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
                                {ebaySyncMutation.data?.message || 'Sync completed successfully'}
                            </div>
                        </motion.div>
                    )}

                    {ebaySyncMutation.isError && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-4 bg-red-50 border border-red-200 rounded-2xl"
                        >
                            <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">
                                Sync failed - check console for details
                            </div>
                        </motion.div>
                    )}

                    {accounts.length > 0 && (
                        <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
                            {accounts.map((account) => {
                                const lastSyncDate = account.last_sync_date
                                    ? new Date(account.last_sync_date)
                                    : null;
                                const tokenExpiry = new Date(account.token_expires_at);
                                const now = new Date();
                                const isTokenExpired = tokenExpiry < now;
                                const tokenExpiresInMinutes = Math.floor((tokenExpiry.getTime() - now.getTime()) / 1000 / 60);

                                return (
                                    <div key={account.id} className="p-3 bg-gray-50 rounded-xl border border-gray-200 min-w-[260px] flex-shrink-0">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="text-xs font-black text-gray-900">{account.account_name}</div>
                                            <div className={`px-2 py-0.5 rounded text-[8px] font-bold ${
                                                account.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                                            }`}>
                                                {account.is_active ? 'ACTIVE' : 'INACTIVE'}
                                            </div>
                                        </div>

                                        <div className="space-y-1.5">
                                            <div className="text-[9px] text-gray-500">
                                                {lastSyncDate
                                                    ? `Last: ${lastSyncDate.toLocaleString()}`
                                                    : 'Never synced'}
                                            </div>

                                            <div className="text-[9px] text-gray-500">
                                                Token: {isTokenExpired ? (
                                                    <span className="text-red-600 font-bold">Expired</span>
                                                ) : (
                                                    <span className={tokenExpiresInMinutes < 30 ? 'text-orange-600 font-bold' : ''}>
                                                        {tokenExpiresInMinutes < 60 ? `${tokenExpiresInMinutes}m` : `${Math.floor(tokenExpiresInMinutes / 60)}h`}
                                                    </span>
                                                )}
                                            </div>

                                            {(isTokenExpired || tokenExpiresInMinutes < 30) && (
                                                <button
                                                    onClick={() => refreshTokenMutation.mutate(account.account_name)}
                                                    disabled={refreshTokenMutation.isPending}
                                                    className="w-full text-[9px] font-bold px-2 py-1 rounded bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors disabled:opacity-50"
                                                >
                                                    {refreshTokenMutation.isPending ? '⟳ Refreshing...' : '🔄 Refresh'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                    <SearchBar
                        value={searchTerm}
                        onChange={setSearchTerm}
                        placeholder="Search product title, SKU, or Order ID..."
                        className="flex-1 max-w-md w-full"
                    />

                    <div className="flex gap-2 p-1 bg-white rounded-2xl border border-gray-200 shadow-sm w-fit">
                        {(['out of stock', 'all'] as const).map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setFilterTab(tab)}
                                className={`px-4 py-1.5 rounded-xl font-black text-[9px] uppercase tracking-wider transition-all ${
                                    filterTab === tab
                                        ? tab === 'out of stock'
                                            ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
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
                            {selectedOrderIds.length} selected
                        </span>
                        <button
                            onClick={toggleSelectAllVisible}
                            disabled={orders.length === 0}
                            className="px-3 py-1.5 rounded-xl border border-gray-200 text-[9px] font-black uppercase tracking-widest text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                            {allVisibleSelected ? 'Unselect Visible' : 'Select Visible'}
                        </button>
                        <button
                            onClick={() => setSelectedOrderIds([])}
                            disabled={selectedOrderIds.length === 0}
                            className="px-3 py-1.5 rounded-xl border border-gray-200 text-[9px] font-black uppercase tracking-widest text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                            Clear
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
                                    <div className="flex items-start gap-3">
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleSelectOrder(order.id)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between mb-2 gap-2">
                                                <ShipByDate date={order.ship_by_date} />
                                                <div className="flex items-center gap-2">
                                                    {order.out_of_stock && (
                                                        <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-orange-100 text-orange-700">
                                                            Out of Stock
                                                        </span>
                                                    )}
                                                    <span className="text-[9px] font-mono font-black text-gray-700">#{order.order_id}</span>
                                                </div>
                                            </div>

                                            <div className="mb-4">
                                                <h3 className="text-base font-black text-gray-900 leading-tight">{order.product_title}</h3>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                                                <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">
                                                        Order ID
                                                    </p>
                                                    <p className="text-xs font-mono font-bold text-gray-800">
                                                        {order.order_id}
                                                    </p>
                                                </div>
                                                <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">
                                                        Tracking #
                                                    </p>
                                                    <p className="text-xs font-mono font-bold text-gray-800">
                                                        {order.shipping_tracking_number ? order.shipping_tracking_number.slice(-4) : '—'}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">
                                                        SKU
                                                    </p>
                                                    <p className="text-xs font-mono font-bold text-gray-800">{order.sku}</p>
                                                </div>
                                                <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">
                                                        Tester
                                                    </p>
                                                    <p className="text-xs font-bold text-gray-800">{getStaffNameById(order.tester_id) || 'Unassigned'}</p>
                                                </div>
                                                <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">
                                                        Packer
                                                    </p>
                                                    <p className="text-xs font-bold text-gray-800">{getStaffNameById(order.packer_id) || 'Unassigned'}</p>
                                                </div>
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
