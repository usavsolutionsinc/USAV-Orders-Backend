'use client';

import { useState } from 'react';
import { Database, Loader2, Check, X, BarChart3, TrendingUp, Package, AlertCircle, ChevronLeft, ChevronRight, Tool, Settings, History, Search } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';
import { SearchBar } from './ui/SearchBar';

export default function DashboardSidebar() {
    const [isSyncing, setIsSyncing] = useState(false);
    const [isTransferring, setIsTransferring] = useState(false);
    const [manualSheetName, setManualSheetName] = useState('');
    const [activeScript, setActiveScript] = useState<string | null>(null);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [expandedMenu, setExpandedMenu] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const handleSearch = (query: string) => {
        if (!query.trim()) return;
        // Search logic could go here or redirect to a search page
        window.location.href = `/shipped?search=${encodeURIComponent(query)}`;
    };

    const handleSync = async () => {
        setIsSyncing(true);
        setStatus(null);
        try {
            const res = await fetch('/api/sync-sheets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'sync_all' }),
            });
            const data = await res.json();
            if (data.success) {
                setStatus({ type: 'success', message: data.message || 'Sync completed successfully' });
            } else {
                setStatus({ type: 'error', message: data.error || data.message || 'Sync failed' });
            }
        } catch (error) {
            setStatus({ type: 'error', message: 'Network error occurred' });
        } finally {
            setIsSyncing(false);
        }
    };

    const handleTransfer = async () => {
        setIsTransferring(true);
        setStatus(null);
        try {
            const res = await fetch('/api/google-sheets/transfer-orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    manualSheetName: manualSheetName.trim() || undefined
                }),
            });
            const data = await res.json();
            if (data.success) {
                const message = data.rowCount > 0 
                    ? `Successfully transferred ${data.rowCount} order${data.rowCount === 1 ? '' : 's'}` 
                    : 'Orders are already transferred';
                setStatus({ type: 'success', message });
            } else {
                setStatus({ type: 'error', message: data.error || 'Transfer failed' });
            }
        } catch (error) {
            setStatus({ type: 'error', message: 'Network error occurred' });
        } finally {
            setIsTransferring(false);
        }
    };

    const runScript = async (scriptName: string) => {
        setActiveScript(scriptName);
        setStatus(null);
        try {
            const res = await fetch('/api/google-sheets/execute-script', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scriptName }),
            });
            const data = await res.json();
            if (data.success) {
                setStatus({ type: 'success', message: data.message });
            } else {
                setStatus({ type: 'error', message: data.error || 'Script execution failed' });
            }
        } catch (error) {
            setStatus({ type: 'error', message: 'Network error occurred' });
        } finally {
            setActiveScript(null);
        }
    };

    const menuItems = [
        {
            id: 'orders',
            name: 'Orders',
            icon: <Database className="w-4 h-4" />,
            scripts: [
                { id: 'updateNonshippedOrders', name: 'Update Nonshipped Orders' }
            ]
        },
        {
            id: 'shipping',
            name: 'Shipping',
            icon: <TrendingUp className="w-4 h-4" />,
            scripts: [
                { id: 'checkShippedOrders', name: 'Check Shipped Orders' }
            ]
        },
        {
            id: 'technicians',
            name: 'Technicians',
            icon: <Tool className="w-4 h-4" />,
            scripts: [
                { id: 'syncTechSerialNumbers', name: 'Sync Tech Serial Numbers' }
            ]
        },
        {
            id: 'packers',
            name: 'Packers',
            icon: <Package className="w-4 h-4" />,
            scripts: [
                { id: 'syncPackerLogs', name: 'Sync Packer Logs' }
            ]
        }
    ];

    return (
        <div className="relative flex-shrink-0 z-40 h-full">
            <aside
                className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-200 relative group w-[340px]"
            >
                <div className="p-6 h-full flex flex-col space-y-6 overflow-y-auto scrollbar-hide">
                    <header>
                        <h2 className="text-xl font-black tracking-tighter uppercase leading-none text-gray-900">
                            Management
                        </h2>
                            <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mt-1">
                            Database & Metrics
                        </p>
                    </header>
                    
                    <div className="space-y-4">
                        <SearchBar 
                            value={searchQuery}
                            onChange={setSearchQuery}
                            onSearch={handleSearch}
                            placeholder="Search orders, serials..."
                            variant="blue"
                            rightElement={
                                <button
                                    onClick={() => handleSearch(searchQuery)}
                                    className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl transition-all active:scale-95 shadow-lg shadow-blue-600/10"
                                    title="Search"
                                >
                                    <Search className="w-4 h-4" />
                                </button>
                            }
                        />

                        {/* Order Management Tools */}
                        <div className="space-y-4 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                            <div className="flex items-center gap-2 mb-2">
                                <Settings className="w-4 h-4 text-blue-600" />
                                <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-900">Order Management</h3>
                            </div>

                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <label className="text-[9px] font-black text-gray-500 uppercase px-1 tracking-widest">Manual Sheet Name</label>
                                    <input
                                        type="text"
                                        value={manualSheetName}
                                        onChange={(e) => setManualSheetName(e.target.value)}
                                        placeholder="e.g., Sheet_01_14_2026"
                                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-[11px] font-mono text-gray-900 outline-none focus:border-blue-500 transition-all"
                                        disabled={isTransferring}
                                    />
                                </div>

                                <button
                                    onClick={handleTransfer}
                                    disabled={isTransferring}
                                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-600/10 transition-all active:scale-95 flex items-center justify-center gap-2"
                                >
                                    {isTransferring ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <Database className="w-3.5 h-3.5" />
                                    )}
                                    Import Latest Orders
                                </button>
                            </div>
                        </div>

                        <button
                            onClick={handleSync}
                            disabled={isSyncing}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-2xl p-4 flex flex-col items-center gap-2 transition-all group active:scale-95 shadow-lg shadow-emerald-600/10"
                        >
                            {isSyncing ? (
                                <Loader2 className="w-6 h-6 animate-spin" />
                            ) : (
                                <Database className="w-6 h-6 group-hover:scale-110 transition-transform" />
                            )}
                            <div className="text-center">
                                <p className="text-[10px] font-black uppercase tracking-widest">Sync All to Neon DB</p>
                                <p className="text-[8px] font-bold opacity-60 uppercase mt-0.5">Full Database Sync</p>
                            </div>
                        </button>

                        {status && (
                            <div className={`p-4 rounded-2xl border ${status.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'} flex items-start gap-3`}>
                                {status.type === 'success' ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <X className="w-4 h-4 mt-0.5 shrink-0" />}
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest">{status.type === 'success' ? 'Success' : 'Error'}</p>
                                    <p className="text-[9px] font-medium leading-relaxed">{status.message}</p>
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <p className="text-[11px] font-black text-gray-400 uppercase tracking-[0.15em] ml-2 mb-4">Automation Scripts</p>
                            {menuItems.map((menu) => (
                                <motion.div key={menu.id} layout className="space-y-1">
                                    <button
                                        onClick={() => setExpandedMenu(expandedMenu === menu.id ? null : menu.id)}
                                        className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all duration-300 ${expandedMenu === menu.id ? 'bg-blue-50 text-blue-600 shadow-sm border border-blue-100' : 'bg-gray-50 text-gray-500 border border-gray-100 hover:bg-gray-100 hover:text-gray-900'}`}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`p-2.5 rounded-xl transition-colors duration-300 ${expandedMenu === menu.id ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                                                {menu.icon}
                                            </div>
                                            <span className="text-[11px] font-black uppercase tracking-wider">{menu.name}</span>
                                        </div>
                                        {expandedMenu === menu.id ? <ChevronLeft className="w-3.5 h-3.5 -rotate-90 transition-transform duration-300" /> : <ChevronRight className="w-3.5 h-3.5 transition-transform duration-300" />}
                                    </button>
                                    <AnimatePresence initial={false}>
                                        {expandedMenu === menu.id && (
                                            <motion.div
                                                initial={{ gridTemplateRows: '0fr', opacity: 0, paddingTop: 0, paddingBottom: 0 }}
                                                animate={{ gridTemplateRows: '1fr', opacity: 1, paddingTop: 8, paddingBottom: 8 }}
                                                exit={{ gridTemplateRows: '0fr', opacity: 0, paddingTop: 0, paddingBottom: 0 }}
                                                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                                                className="grid px-3 overflow-hidden"
                                            >
                                                <div className="overflow-hidden">
                                                    <div className="space-y-1.5">
                                                        {menu.scripts.length > 0 ? (
                                                            menu.scripts.map((script) => (
                                                                <button
                                                                    key={script.id}
                                                                    onClick={() => runScript(script.id)}
                                                                    disabled={!!activeScript}
                                                                    className={`w-full text-left p-3.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all duration-200 ${activeScript === script.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-900 group'} flex items-center justify-between group`}
                                                                >
                                                                    <span className="group-hover:translate-x-1 transition-transform duration-200">{script.name}</span>
                                                                    {activeScript === script.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                                                </button>
                                                            ))
                                                        ) : (
                                                            <div className="p-3.5 rounded-xl bg-gray-50 text-gray-400 text-[10px] font-bold uppercase tracking-widest">
                                                                No scripts configured yet
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            ))}
                        </div>
                    </div>

                    <footer className="mt-auto pt-4 border-t border-gray-100 opacity-30 text-center">
                        <p className="text-[7px] font-mono uppercase tracking-[0.2em] text-gray-500">USAV INFRASTRUCTURE</p>
                    </footer>
                </div>
            </aside>
        </div>
    );
}
