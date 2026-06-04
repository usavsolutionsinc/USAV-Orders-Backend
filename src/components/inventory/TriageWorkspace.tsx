'use client';

import { useState } from 'react';
import { 
    Search, 
    Filter, 
    AlertTriangle, 
    ArrowRight, 
    Plus, 
    Clock, 
    CheckCircle2, 
    XCircle, 
    MessageSquare,
    ChevronDown,
    Flag,
    Zap,
    Tag,
    Box,
    ExternalLink
} from 'lucide-react';
import { cn } from '@/utils/_cn';

// In a real implementation, these would come from an API/hook.
const MOCK_EXCEPTIONS = [
    { 
        id: 'EXP-101', 
        type: 'Damaged', 
        sku: 'SNY-PS5-DISC', 
        severity: 'high', 
        title: 'Box crushed during forklift move', 
        date: '10m ago',
        reporter: 'Michael K.',
        location: 'A-01-02',
        status: 'inbox',
        notes: 3
    },
    { 
        id: 'EXP-104', 
        type: 'Mismatch', 
        sku: 'MSF-XBS-X', 
        severity: 'high', 
        title: 'Label says Black, Unit is White Edition', 
        date: '5h ago',
        reporter: 'Michael K.',
        location: 'Receiving',
        status: 'pending-action',
        notes: 5
    },
];

interface TriageWorkspaceProps {
    selectedId: string | null;
}

export function TriageWorkspace({ selectedId }: TriageWorkspaceProps) {
    const activeException = MOCK_EXCEPTIONS.find(ex => ex.id === selectedId) || MOCK_EXCEPTIONS[0];

    if (!selectedId && MOCK_EXCEPTIONS.length > 0) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-50 text-gray-400">
                <div className="text-center space-y-2">
                    <AlertTriangle className="h-12 w-12 mx-auto opacity-20" />
                    <p className="text-sm font-medium">Select an issue from the sidebar to begin triage</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full flex-col min-w-0 bg-white">
            {/* Header Row */}
            <header className="h-14 shrink-0 border-b border-gray-100 flex items-center justify-between px-6 bg-white/50 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-1 bg-gray-50 rounded-full border border-gray-200">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</span>
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                        <span className="text-[11px] font-bold text-gray-900 uppercase tracking-wider">{activeException.status.replace('-', ' ')}</span>
                        <ChevronDown className="h-3 w-3 text-gray-400" />
                    </div>
                    <div className="h-4 w-px bg-gray-200 mx-1" />
                    <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-gray-400" />
                        <span className="text-[11px] font-bold text-gray-500">Open for 1 hour 12 minutes</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-100">
                        <Flag className="h-3.5 w-3.5" /> Flag
                    </button>
                    <button className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-100">
                        <Zap className="h-3.5 w-3.5" /> Assign
                    </button>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-4xl mx-auto space-y-8">
                    {/* Summary Block */}
                    <div className="flex items-start justify-between">
                        <div className="space-y-4 flex-1">
                            <div className="space-y-1">
                                <div className="flex items-center gap-3">
                                    <h1 className="text-3xl font-black text-gray-900 tracking-tight">{activeException.sku}</h1>
                                    <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><ExternalLink className="h-5 w-5" /></button>
                                </div>
                                <p className="text-lg font-bold text-gray-500">{activeException.title}</p>
                            </div>
                            <div className="flex flex-wrap gap-6">
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Location Found</p>
                                    <div className="flex items-center gap-2">
                                        <Tag className="h-3.5 w-3.5 text-blue-600" />
                                        <span className="text-sm font-black text-gray-900">{activeException.location}</span>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Reported By</p>
                                    <div className="flex items-center gap-2">
                                        <div className="h-4 w-4 rounded-full bg-blue-500 flex items-center justify-center text-[7px] font-bold text-white">MK</div>
                                        <span className="text-sm font-black text-gray-900">{activeException.reporter}</span>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Issue Type</p>
                                    <span className="flex items-center gap-2">
                                        <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
                                        <span className="text-sm font-black text-gray-900 uppercase">{activeException.type}</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="h-24 w-24 rounded-3xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-200">
                            <Box className="h-10 w-10" />
                        </div>
                    </div>

                    {/* Action Grid */}
                    <div className="grid grid-cols-3 gap-4">
                        <button className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-emerald-100 bg-emerald-50/30 p-6 transition-all hover:bg-emerald-50 group">
                            <div className="h-12 w-12 rounded-xl bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-200 group-hover:scale-110 transition-transform">
                                <CheckCircle2 className="h-6 w-6" />
                            </div>
                            <div className="text-center">
                                <p className="text-xs font-black uppercase tracking-widest text-emerald-700">Approve Fix</p>
                                <p className="text-[10px] font-bold text-emerald-600 opacity-60">Move to Resolved</p>
                            </div>
                        </button>
                        <button className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-blue-100 bg-blue-50/30 p-6 transition-all hover:bg-blue-50 group">
                            <div className="h-12 w-12 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-200 group-hover:scale-110 transition-transform">
                                <ArrowRight className="h-6 w-6" />
                            </div>
                            <div className="text-center">
                                <p className="text-xs font-black uppercase tracking-widest text-blue-700">Transfer Unit</p>
                                <p className="text-[10px] font-bold text-blue-600 opacity-60">Redirect to RTV</p>
                            </div>
                        </button>
                        <button className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-rose-100 bg-rose-50/30 p-6 transition-all hover:bg-rose-50 group">
                            <div className="h-12 w-12 rounded-xl bg-rose-600 flex items-center justify-center text-white shadow-lg shadow-rose-200 group-hover:scale-110 transition-transform">
                                <XCircle className="h-6 w-6" />
                            </div>
                            <div className="text-center">
                                <p className="text-xs font-black uppercase tracking-widest text-rose-700">Write Off</p>
                                <p className="text-[10px] font-bold text-rose-600 opacity-60">Mark as Scrapped</p>
                            </div>
                        </button>
                    </div>

                    {/* Discussion / Timeline */}
                    <div className="space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 flex items-center gap-2">
                            <MessageSquare className="h-4 w-4" /> Discussion & History
                        </h3>
                        <div className="space-y-4 relative pl-8 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-px before:bg-gray-100">
                            <div className="relative">
                                <div className="absolute -left-6 top-1 h-3 w-3 rounded-full border-2 border-white bg-blue-500 shadow-sm" />
                                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-black text-gray-900">Michael K. <span className="font-bold text-gray-400 ml-2">Reported Issue</span></span>
                                        <span className="text-[10px] font-bold text-gray-400">10m ago</span>
                                    </div>
                                    <p className="text-sm text-gray-600">While moving unit from receiving to A-01-02, the corner of the box was crushed by the adjacent rack. Damage is aesthetic but might affect resale grade.</p>
                                </div>
                            </div>
                            <div className="relative">
                                <div className="absolute -left-6 top-1 h-3 w-3 rounded-full border-2 border-white bg-amber-500 shadow-sm" />
                                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-black text-gray-900">John D. <span className="font-bold text-gray-400 ml-2">Investigated</span></span>
                                        <span className="text-[10px] font-bold text-gray-400">2m ago</span>
                                    </div>
                                    <p className="text-sm text-gray-600">Inspected unit. The seal is intact. We should probably downgrade this to 'USED_A' and list it as open-box.</p>
                                </div>
                            </div>
                            
                            <div className="pt-2">
                                <div className="relative">
                                    <textarea 
                                        placeholder="Add a note or instruction..."
                                        className="w-full rounded-2xl border border-gray-200 bg-white p-4 text-sm focus:border-blue-500 focus:outline-none min-h-[100px] shadow-sm"
                                    />
                                    <div className="absolute bottom-3 right-3 flex gap-2">
                                        <button className="rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-black uppercase tracking-widest text-white shadow-lg">Post Note</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
