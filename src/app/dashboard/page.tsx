'use client';

import DashboardSidebar from '@/components/DashboardSidebar';
import { Database, Settings, Loader2 } from '@/components/Icons';
import { useState } from 'react';

import PageLayout from '@/components/PageLayout';

export default function DashboardPage() {
    const [isTransferring, setIsTransferring] = useState(false);
    const [manualSheetName, setManualSheetName] = useState('');
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    const handleTransfer = async () => {
        setIsTransferring(true);
        setStatus(null);
        try {
            const res = await fetch('/api/google-sheets/transfer-orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ manualSheetName: manualSheetName.trim() || undefined }),
            });
            const data = await res.json();
            if (data.success) {
                setStatus({ type: 'success', message: data.rowCount > 0 ? `Imported ${data.rowCount} orders` : 'Already up to date' });
            } else {
                setStatus({ type: 'error', message: data.error || 'Transfer failed' });
            }
        } catch (error) {
            setStatus({ type: 'error', message: 'Network error occurred' });
        } finally {
            setIsTransferring(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Top Toolbar for Dashboard */}
            <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm z-10 pl-20">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-3">
                        <Settings className="w-4 h-4 text-blue-600" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-900">Order Management</span>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Manual Sheet:</span>
                            <input
                                type="text"
                                value={manualSheetName}
                                onChange={(e) => setManualSheetName(e.target.value)}
                                placeholder="Sheet_MM_DD_YYYY"
                                className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-[10px] font-mono outline-none focus:border-blue-500 w-40 transition-all"
                            />
                        </div>
                        
                        <button
                            onClick={handleTransfer}
                            disabled={isTransferring}
                            className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-blue-600/10"
                        >
                            {isTransferring ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
                            Import Latest Orders
                        </button>
                    </div>
                </div>

                {status && (
                    <div className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest animate-in fade-in slide-in-from-right-2 ${
                        status.type === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}>
                        {status.message}
                    </div>
                )}
            </div>

            <PageLayout
                sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
                showChecklist={false}
                showSidebar={false}
                editMode={true}
                customSidebar={<DashboardSidebar />}
            />
        </div>
    );
}

