'use client';

import { useState } from 'react';
import { 
    Search, 
    User, 
    Clock, 
    ArrowRight, 
    Package, 
    Truck, 
    Move, 
    RefreshCcw, 
    Tag, 
    ChevronRight, 
    MapPin, 
    ShieldCheck, 
    FileText, 
    Camera, 
    MoreHorizontal,
    Database,
    Info,
    Layout,
    History
} from 'lucide-react';
import { cn } from '@/utils/_cn';

// Mock data; would be an API call in production.
const MOCK_EVENTS = [
    { 
        id: 1, 
        type: 'ship', 
        title: 'Dispatched to Customer', 
        user: 'Michael K.', 
        time: '20m ago', 
        details: 'Order #92831 · UPS 1Z999...', 
        icon: Truck, 
        color: 'text-emerald-600', 
        bg: 'bg-emerald-50' 
    },
    { 
        id: 2, 
        type: 'pack', 
        title: 'Quality Checked & Packed', 
        user: 'Michael K.', 
        time: '1h ago', 
        details: 'Station #4 · Small Box A · Condition: Sealed', 
        icon: ShieldCheck, 
        color: 'text-blue-600', 
        bg: 'bg-blue-50' 
    },
    { 
        id: 3, 
        type: 'pick', 
        title: 'Picked from Storage', 
        user: 'John D.', 
        time: '3h ago', 
        details: 'Bin A-01-02 · Batch #42', 
        icon: ArrowRight, 
        color: 'text-orange-600', 
        bg: 'bg-orange-50' 
    },
    { 
        id: 4, 
        type: 'move', 
        title: 'Internal Relocation', 
        user: 'System (Auto)', 
        time: '1d ago', 
        details: 'From Receiving Triage to A-01-02', 
        icon: Move, 
        color: 'text-gray-600', 
        bg: 'bg-gray-100' 
    },
    { 
        id: 5, 
        type: 'receive', 
        title: 'Inventory Ingested', 
        user: 'Sarah S.', 
        time: '2d ago', 
        details: 'PO #8812 · Bulk Batch #12 · Grade: New', 
        icon: RefreshCcw, 
        color: 'text-purple-600', 
        bg: 'bg-purple-50' 
    },
];

interface PulseWorkspaceProps {
    unitId: string | null;
}

export function PulseWorkspace({ unitId }: PulseWorkspaceProps) {
    const [selectedEventId, setSelectedEventId] = useState<number>(1);
    const activeEvent = MOCK_EVENTS.find(e => e.id === selectedEventId) || MOCK_EVENTS[0];

    if (!unitId && MOCK_EVENTS.length > 0) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-50 text-gray-400">
                <div className="text-center space-y-2">
                    <History className="h-12 w-12 mx-auto opacity-20" />
                    <p className="text-sm font-medium">Select a unit from the pulse feed to see deep trace history</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full flex-col bg-white overflow-y-auto">
            <div className="max-w-4xl mx-auto p-12 w-full">
                {/* Hero Identity */}
                <div className="mb-12 flex items-end justify-between border-b border-gray-100 pb-8">
                    <div className="flex items-center gap-6">
                        <div className="h-24 w-24 rounded-[2rem] bg-blue-600 flex items-center justify-center text-white shadow-2xl shadow-blue-200 rotate-3 transition-transform hover:rotate-0 cursor-pointer group">
                            <Tag className="h-10 w-10 group-hover:scale-110 transition-transform" />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center gap-3">
                                <h1 className="text-4xl font-black text-gray-900 tracking-tight">SNY-PS5-DISC</h1>
                                <button className="p-2 hover:bg-gray-100 rounded-xl text-gray-400"><Info className="h-5 w-5" /></button>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="rounded-lg bg-gray-900 px-3 py-1 text-xs font-black text-white uppercase tracking-widest">UNIT #{unitId || '88129'}</span>
                                <span className="text-sm font-bold text-gray-400">|</span>
                                <span className="flex items-center gap-1.5 text-sm font-black text-emerald-600 uppercase tracking-widest">
                                    <ShieldCheck className="h-4 w-4" /> Authenticated
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Current Custody</p>
                        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 px-4 py-2 rounded-2xl">
                            <User className="h-4 w-4 text-emerald-600" />
                            <span className="text-sm font-black text-emerald-700">Outbound Logistics</span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-12 gap-12">
                    {/* Timeline Column */}
                    <div className="col-span-7 space-y-1">
                        <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400 mb-6 flex items-center gap-2">
                            <History className="h-4 w-4" /> Chain of Custody
                        </h2>
                        
                        <div className="relative pl-8 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-100">
                            {MOCK_EVENTS.map((event, i) => (
                                <div key={event.id} className="relative pb-10 last:pb-0 group cursor-pointer" onClick={() => setSelectedEventId(event.id)}>
                                    {/* Dot */}
                                    <div className={cn(
                                        "absolute -left-8 top-1.5 h-6 w-6 rounded-full border-4 border-white shadow-md flex items-center justify-center transition-all z-10",
                                        selectedEventId === event.id ? "bg-blue-600 scale-110" : "bg-gray-200 group-hover:bg-gray-300"
                                    )}>
                                        <div className="h-1.5 w-1.5 rounded-full bg-white" />
                                    </div>
                                    
                                    <div className={cn(
                                        "p-5 rounded-3xl border transition-all",
                                        selectedEventId === event.id 
                                            ? "bg-white border-blue-100 shadow-xl shadow-blue-50 ring-1 ring-blue-50" 
                                            : "bg-gray-50/50 border-transparent hover:bg-gray-50 hover:border-gray-200"
                                    )}>
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <event.icon className={cn("h-4 w-4", event.color)} />
                                                <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">{event.title}</h3>
                                            </div>
                                            <span className="text-[10px] font-bold text-gray-400">{event.time}</span>
                                        </div>
                                        <p className="text-sm text-gray-600 mb-4">{event.details}</p>
                                        
                                        <div className="flex items-center justify-between border-t border-gray-100/50 pt-4">
                                            <div className="flex items-center gap-2">
                                                <div className="h-7 w-7 rounded-full bg-white border border-gray-200 flex items-center justify-center text-[10px] font-black text-gray-700 shadow-sm">
                                                    {event.user.charAt(0)}
                                                </div>
                                                <span className="text-[11px] font-bold text-gray-900 uppercase tracking-widest">{event.user}</span>
                                            </div>
                                            <button className="text-[10px] font-black text-blue-600 uppercase hover:underline">View Evidence</button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Metadata / Evidence Column */}
                    <div className="col-span-5 space-y-6">
                        {/* Evidence Box */}
                        <div className="rounded-3xl border border-gray-100 bg-gray-50/50 p-6 space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 flex items-center gap-2">
                                <Camera className="h-4 w-4" /> Scan Evidence
                            </h3>
                            <div className="aspect-[4/3] rounded-2xl bg-gray-200 flex items-center justify-center text-gray-400 border-2 border-dashed border-gray-300 group cursor-pointer hover:bg-gray-100 transition-colors">
                                <div className="text-center">
                                    <Camera className="h-8 w-8 mx-auto mb-2 opacity-50 group-hover:scale-110 transition-transform" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">No photo on file</p>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Weight</span>
                                    <span className="text-xs font-black text-gray-900">4.52 kg</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Dimensions</span>
                                    <span className="text-xs font-black text-gray-900">39 x 10 x 26 cm</span>
                                </div>
                            </div>
                        </div>

                        {/* Location Context */}
                        <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-xl shadow-gray-100 space-y-6">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 flex items-center gap-2">
                                <MapPin className="h-4 w-4" /> Location Context
                            </h3>
                            <div className="flex items-center gap-4">
                                <div className="h-12 w-12 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600">
                                    <Database className="h-6 w-6" />
                                </div>
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Last Known Storage</p>
                                    <p className="text-lg font-black text-gray-900 tracking-tight">BIN A-01-02</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
