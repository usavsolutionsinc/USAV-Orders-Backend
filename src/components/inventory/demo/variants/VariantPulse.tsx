'use client';

import { Search, User, Clock, ArrowRight, Package, Truck, Move, RefreshCcw, Tag } from 'lucide-react';
import { cn } from '@/utils/_cn';

const MOCK_TIMELINE = [
    { id: 1, type: 'ship', title: 'Unit Shipped', user: 'Michael K.', time: '20m ago', details: 'Order #92831 · UPS 1Z999...', icon: Truck, color: 'bg-emerald-500' },
    { id: 2, type: 'pack', title: 'Packed in Box', user: 'Michael K.', time: '1h ago', details: 'Station #4 · Small Box A', icon: Package, color: 'bg-blue-500' },
    { id: 3, type: 'pick', title: 'Picked from Bin', user: 'John D.', time: '3h ago', details: 'Bin A-01-02 · Batch #42', icon: ArrowRight, color: 'bg-orange-500' },
    { id: 4, type: 'move', title: 'Relocated', user: 'System', time: '1d ago', details: 'From Receiving to A-01-02', icon: Move, color: 'bg-gray-500' },
    { id: 5, type: 'receive', title: 'Unit Received', user: 'Sarah S.', time: '2d ago', details: 'PO #8812 · Condition: New', icon: RefreshCcw, color: 'bg-purple-500' },
];

export function VariantPulse() {
    return (
        <div className="flex h-full w-full overflow-hidden">
            {/* Sidebar: Activity Feed */}
            <aside className="w-80 shrink-0 border-r border-gray-200 bg-white flex flex-col">
                <div className="p-4 border-b border-gray-200">
                    <h2 className="text-xs font-black uppercase tracking-widest text-gray-900 mb-4">Live Activity Feed</h2>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                        <input 
                            type="text" 
                            placeholder="Search events, units, or users..." 
                            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto">
                    {MOCK_TIMELINE.map(event => (
                        <button key={event.id} className="w-full p-4 text-left hover:bg-gray-50 border-b border-gray-50 group">
                            <div className="flex items-center gap-3">
                                <div className={cn("h-8 w-8 rounded-full flex items-center justify-center text-white", event.color)}>
                                    <event.icon className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-xs font-bold text-gray-900 truncate">{event.title}</h3>
                                    <p className="text-[10px] text-gray-400 font-medium">{event.user} · {event.time}</p>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </aside>

            {/* Main Content: Detailed Timeline */}
            <div className="flex-1 overflow-y-auto bg-white p-12">
                <div className="max-w-2xl mx-auto">
                    <div className="mb-12">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="h-16 w-16 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100 shadow-sm">
                                <Tag className="h-8 w-8" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-black tracking-tight text-gray-900">APL-IPH15-256-BLK</h1>
                                <p className="text-sm font-medium text-gray-500">Unit ID: <span className="text-blue-600 font-mono">#UNIT-88129</span> · Status: <span className="text-emerald-600 font-bold uppercase tracking-wider text-xs">Shipped</span></p>
                            </div>
                        </div>
                    </div>

                    <div className="relative">
                        {/* Timeline Line */}
                        <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-gray-100" />

                        <div className="space-y-12">
                            {MOCK_TIMELINE.map((event, i) => (
                                <div key={event.id} className="relative pl-12">
                                    {/* Timeline Dot */}
                                    <div className={cn(
                                        "absolute left-2.5 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-white ring-4 ring-white shadow-sm z-10",
                                        event.color
                                    )} />
                                    
                                    <div className="flex items-start justify-between">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-3">
                                                <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">{event.title}</h3>
                                                <span className="text-xs font-medium text-gray-400">{event.time}</span>
                                            </div>
                                            <p className="text-sm text-gray-600">{event.details}</p>
                                        </div>
                                        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-100">
                                            <div className="h-6 w-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600">
                                                {event.user.charAt(0)}
                                            </div>
                                            <span className="text-xs font-bold text-gray-700">{event.user}</span>
                                        </div>
                                    </div>

                                    {/* Event Meta Card */}
                                    <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50/50 p-4">
                                        <div className="grid grid-cols-3 gap-8">
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">System Action</p>
                                                <p className="text-xs font-bold text-gray-700">Inventory State Change</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Station ID</p>
                                                <p className="text-xs font-bold text-gray-700">ST-04-A</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Duration</p>
                                                <p className="text-xs font-bold text-gray-700">42 seconds</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
