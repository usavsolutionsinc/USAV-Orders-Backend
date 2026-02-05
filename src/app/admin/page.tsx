'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Check, X, Wrench, Package, Search } from '@/components/Icons';
import { motion, AnimatePresence } from 'framer-motion';
import EbayManagement from '@/components/EbayManagement';
import { SearchBar } from '@/components/ui/SearchBar';

interface Staff {
    id: number;
    name: string;
    role: string;
    employee_id: string | null;
    active: boolean;
}

interface Order {
    id: number;
    ship_by_date: string;
    order_id: string;
    product_title: string;
    sku: string;
    tester_id: number | null;
    packer_id: number | null;
    out_of_stock: string | null;
    is_shipped: boolean;
}

export default function AdminPage() {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<'staff' | 'orders' | 'ebay'>('orders');
    const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([]);
    
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
                            onClick={() => setActiveTab('ebay')}
                            className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                                activeTab === 'ebay' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                            }`}
                        >
                            eBay
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
                    {activeTab === 'ebay' ? (
                        <EbayManagement />
                    ) : activeTab === 'staff' ? (
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
                        <OrdersManagement 
                            staff={staff} 
                            selectedOrderIds={selectedOrderIds}
                            setSelectedOrderIds={setSelectedOrderIds}
                        />
                    )}
                </div>
            </div>

            {/* Assignment Sidebar - Right Side */}
            <AnimatePresence>
                {selectedOrderIds.length > 0 && (
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.5 }}
                        className="fixed inset-y-0 right-0 w-[240px] bg-white border-l border-gray-200 shadow-[-20px_0_50px_rgba(0,0,0,0.05)] z-[100] overflow-y-auto no-scrollbar"
                    >
                        {/* Header */}
                        <div className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 p-5 flex items-center justify-between z-10">
                            <div className="flex flex-col text-left">
                                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-600 mb-1">Selection</span>
                                <h2 className="text-lg font-black text-gray-900 tracking-tighter leading-none">
                                    {selectedOrderIds.length} Order{selectedOrderIds.length !== 1 ? 's' : ''}
                                </h2>
                            </div>
                            <button 
                                onClick={() => setSelectedOrderIds([])} 
                                className="p-1.5 hover:bg-gray-50 rounded-xl transition-all border border-transparent hover:border-gray-100"
                            >
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        <div className="p-5 space-y-8">
                            {/* Technicians Section */}
                            <section className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                                        <Wrench className="w-3.5 h-3.5" />
                                    </div>
                                    <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-900">
                                        Technicians
                                    </h3>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    {staff.filter(s => s.role === 'technician' && s.active).map(member => (
                                        <button
                                            key={member.id}
                                            onClick={() => {
                                                fetch('/api/orders/assign', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ orderIds: selectedOrderIds, testerId: member.id }),
                                                }).then(() => {
                                                    queryClient.invalidateQueries({ queryKey: ['orders'] });
                                                    setSelectedOrderIds([]);
                                                });
                                            }}
                                            className="w-full px-4 py-2.5 bg-gray-50 hover:bg-blue-600 text-gray-700 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 border border-gray-100 hover:border-blue-400 shadow-sm text-left"
                                        >
                                            {member.name}
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => {
                                            fetch('/api/orders/assign', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ orderIds: selectedOrderIds, testerId: 0 }),
                                            }).then(() => {
                                                queryClient.invalidateQueries({ queryKey: ['orders'] });
                                                setSelectedOrderIds([]);
                                            });
                                        }}
                                        className="w-full px-4 py-2.5 bg-red-50 hover:bg-red-600 text-red-600 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 border border-red-100 hover:border-red-400 shadow-sm text-left"
                                    >
                                        Unassign Tech
                                    </button>
                                </div>
                            </section>

                            {/* Packers Section */}
                            <section className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                                        <Package className="w-3.5 h-3.5" />
                                    </div>
                                    <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-900">
                                        Packers
                                    </h3>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    {staff.filter(s => s.role === 'packer' && s.active).map(member => (
                                        <button
                                            key={member.id}
                                            onClick={() => {
                                                fetch('/api/orders/assign', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ orderIds: selectedOrderIds, packerId: member.id }),
                                                }).then(() => {
                                                    queryClient.invalidateQueries({ queryKey: ['orders'] });
                                                    setSelectedOrderIds([]);
                                                });
                                            }}
                                            className="w-full px-4 py-2.5 bg-gray-50 hover:bg-blue-600 text-gray-700 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 border border-gray-100 hover:border-blue-400 shadow-sm text-left"
                                        >
                                            {member.name}
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => {
                                            fetch('/api/orders/assign', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ orderIds: selectedOrderIds, packerId: 0 }),
                                            }).then(() => {
                                                queryClient.invalidateQueries({ queryKey: ['orders'] });
                                                setSelectedOrderIds([]);
                                            });
                                        }}
                                        className="w-full px-4 py-2.5 bg-red-50 hover:bg-red-600 text-red-600 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 border border-red-100 hover:border-red-400 shadow-sm text-left"
                                    >
                                        Unassign Packer
                                    </button>
                                </div>
                            </section>

                            {/* Quick Actions */}
                            <section className="pt-6 border-t border-gray-100">
                                <button
                                    onClick={() => setSelectedOrderIds([])}
                                    className="w-full py-3.5 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all active:scale-[0.98] shadow-lg shadow-blue-600/20"
                                >
                                    Done
                                </button>
                            </section>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// Orders Management Component
function OrdersManagement({ 
    staff, 
    selectedOrderIds, 
    setSelectedOrderIds 
}: { 
    staff: Staff[]; 
    selectedOrderIds: number[];
    setSelectedOrderIds: (ids: number[] | ((prev: number[]) => number[])) => void;
}) {
    const queryClient = useQueryClient();
    const [filterTab, setFilterTab] = useState<'out of stock' | 'unassigned' | 'assigned' | 'all'>('all');
    const [searchTerm, setSearchTerm] = useState('');

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
    
    // Apply filtering
    const orders = allOrders.filter(order => {
        // Filter by tab
        const matchesTab = (() => {
            if (filterTab === 'out of stock') return order.out_of_stock && (order.is_shipped === false || !order.is_shipped);
            if (filterTab === 'assigned') return order.tester_id || order.packer_id;
            if (filterTab === 'unassigned') return !order.tester_id && !order.packer_id;
            return true;
        })();

        // Filter by search (fuzzy search on product_title)
        const matchesSearch = order.product_title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                             order.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
                             order.order_id.toLowerCase().includes(searchTerm.toLowerCase());

        return matchesTab && matchesSearch;
    });

    const handleSelectOrder = (orderId: number) => {
        setSelectedOrderIds(prev => 
            prev.includes(orderId) 
                ? prev.filter(id => id !== orderId)
                : [...prev, orderId]
        );
    };

    const handleSelectAll = () => {
        if (selectedOrderIds.length === orders.length) {
            setSelectedOrderIds([]);
        } else {
            setSelectedOrderIds(orders.map(o => o.id));
        }
    };

    const getStaffName = (id: number | null) => {
        if (!id) return null;
        return staff.find(s => s.id === id)?.name || `ID: ${id}`;
    };

    return (
        <div className="space-y-4">
            {/* Header Area with Search and Tabs */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <SearchBar 
                    value={searchTerm}
                    onChange={setSearchTerm}
                    placeholder="Search product title, SKU, or Order ID..."
                    className="flex-1 max-w-md w-full"
                />

                {/* Filter Tabs (Right) */}
                <div className="flex gap-2 p-1 bg-white rounded-2xl border border-gray-200 shadow-sm w-fit">
                    {(['out of stock', 'unassigned', 'assigned', 'all'] as const).map((tab) => (
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

            <div className="flex justify-between items-center bg-white p-4 rounded-3xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3">
                    <button 
                        onClick={handleSelectAll}
                        className="w-5 h-5 border-2 border-gray-300 rounded-md flex items-center justify-center transition-all hover:border-blue-500"
                    >
                        {selectedOrderIds.length === orders.length && orders.length > 0 && (
                            <div className="w-2.5 h-2.5 bg-blue-600 rounded-sm" />
                        )}
                    </button>
                    <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">
                        {selectedOrderIds.length > 0 
                            ? `${selectedOrderIds.length} Selected` 
                            : 'Order Management'}
                    </h2>
                </div>
            </div>

            <div className="grid gap-3 pb-32">
                {orders.length === 0 ? (
                    <div className="p-8 text-center bg-white rounded-3xl border border-gray-200">
                        <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">
                            No orders found
                        </p>
                    </div>
                ) : (
                    orders.map((order) => (
                        <div 
                            key={order.id} 
                            onClick={() => handleSelectOrder(order.id)}
                            className={`p-5 rounded-3xl border transition-all cursor-pointer ${
                                selectedOrderIds.includes(order.id) 
                                    ? 'bg-blue-50 border-blue-200 shadow-sm' 
                                    : 'bg-white border-gray-200 hover:shadow-sm'
                            }`}
                        >
                            <div className="flex items-start gap-4">
                                <div className="pt-1">
                                    <div className={`w-5 h-5 border-2 rounded-md flex items-center justify-center transition-all ${
                                        selectedOrderIds.includes(order.id)
                                            ? 'bg-blue-600 border-blue-600'
                                            : 'border-gray-300'
                                    }`}>
                                        {selectedOrderIds.includes(order.id) && <Check className="w-3.5 h-3.5 text-white" />}
                                    </div>
                                </div>

                                <div className="flex-1 text-left">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3 className="text-base font-black text-gray-900">
                                                    {order.product_title}
                                                </h3>
                                            </div>
                                            <div className="flex items-center gap-3 text-[9px] font-bold text-gray-500 uppercase tracking-widest">
                                                {order.ship_by_date && (
                                                    <>
                                                        <span className="text-blue-600">Ship: {order.ship_by_date}</span>
                                                        <span>•</span>
                                                    </>
                                                )}
                                                <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-700 font-mono">#{order.order_id}</span>
                                                <span>•</span>
                                                <span>SKU: {order.sku}</span>
                                            </div>
                                        </div>
                                        
                                        {order.out_of_stock && (
                                            <span className="px-3 py-1 rounded-xl text-[8px] font-black uppercase tracking-widest bg-orange-100 text-orange-700">
                                                {order.out_of_stock}
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {order.tester_id ? (
                                            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-xl text-[10px] font-black uppercase tracking-widest border border-blue-100">
                                                <Wrench className="w-3 h-3" />
                                                Tester: {getStaffName(order.tester_id)}
                                            </span>
                                        ) : (
                                            <span className="px-3 py-1.5 bg-gray-50 text-gray-400 rounded-xl text-[10px] font-black uppercase tracking-widest border border-dashed border-gray-200">
                                                Tester: Unassigned
                                            </span>
                                        )}
                                        {order.packer_id ? (
                                            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-xl text-[10px] font-black uppercase tracking-widest border border-blue-100">
                                                <Package className="w-3 h-3" />
                                                Packer: {getStaffName(order.packer_id)}
                                            </span>
                                        ) : (
                                            <span className="px-3 py-1.5 bg-gray-50 text-gray-400 rounded-xl text-[10px] font-black uppercase tracking-widest border border-dashed border-gray-200">
                                                Packer: Unassigned
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
