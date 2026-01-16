'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Package, X } from './Icons';

export default function ReceivingEntryForm() {
    const queryClient = useQueryClient();
    const [trackingNumber, setTrackingNumber] = useState('');
    const [orderNumber, setOrderNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [urgentTracking, setUrgentTracking] = useState<string | null>(null);
    const [showUrgentAlert, setShowUrgentAlert] = useState(false);
    const [carrier, setCarrier] = useState('');

    // Load urgent tracking number from localStorage
    useEffect(() => {
        const urgent = localStorage.getItem('urgentTrackingNumber');
        setUrgentTracking(urgent);
    }, []);

    // Check if entered tracking matches urgent tracking
    useEffect(() => {
        if (trackingNumber && urgentTracking) {
            const matches = trackingNumber.toLowerCase().trim() === urgentTracking.toLowerCase().trim();
            setShowUrgentAlert(matches);
        } else {
            setShowUrgentAlert(false);
        }
    }, [trackingNumber, urgentTracking]);

    const createTaskMutation = useMutation({
        mutationFn: async () => {
            // 1. Add to receiving_tasks table
            const taskRes = await fetch('/api/receiving-tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trackingNumber,
                    orderNumber: orderNumber || null,
                    urgent: showUrgentAlert,
                    notes: notes || null,
                }),
            });

            if (!taskRes.ok) throw new Error('Failed to create task');
            const task = await taskRes.json();

            // 2. Add to receiving logs table
            const now = new Date();
            const timestamp = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
            
            const entryRes = await fetch('/api/receiving-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trackingNumber,
                    carrier: carrier || 'Unknown',
                    timestamp,
                    notes: orderNumber ? `Order: ${orderNumber}${notes ? ' - ' + notes : ''}` : notes,
                }),
            });

            if (!entryRes.ok) throw new Error('Failed to add entry');

            return task;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['receivingTasks'] });
            setTrackingNumber('');
            setOrderNumber('');
            setNotes('');
            setCarrier('');
            setShowUrgentAlert(false);
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (trackingNumber.trim()) {
            createTaskMutation.mutate();
        }
    };

    return (
        <div className="relative bg-white text-gray-900 p-6 border-r border-gray-200">
            {/* Urgent Alert Banner */}
            {showUrgentAlert && (
                <div className="absolute top-0 left-0 right-0 bg-red-600 text-white p-3 z-50 animate-pulse">
                    <div className="flex items-center justify-center gap-2">
                        <AlertTriangle className="w-5 h-5" />
                        <span className="text-sm font-black uppercase tracking-wider">
                            URGENT - UNBOX IMMEDIATELY!
                        </span>
                        <AlertTriangle className="w-5 h-5" />
                    </div>
                </div>
            )}

            <div className={`space-y-4 ${showUrgentAlert ? 'mt-16' : ''}`}>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-blue-500 flex items-center justify-center text-white">
                        <Package className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-lg font-black tracking-tighter uppercase text-gray-900">
                            New Shipment
                        </h3>
                        <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">
                            Receiving Entry
                        </p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                    {/* Tracking Number - Primary Field */}
                    <div>
                        <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                            Tracking Number *
                        </label>
                        <input
                            type="text"
                            value={trackingNumber}
                            onChange={(e) => setTrackingNumber(e.target.value)}
                            placeholder="Enter tracking number..."
                            className={`w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm font-bold outline-none transition-all ${
                                showUrgentAlert 
                                    ? 'border-red-500 ring-2 ring-red-500/20 bg-red-50 text-red-900' 
                                    : 'border-gray-200 text-gray-900 focus:ring-2 focus:ring-blue-500'
                            }`}
                            autoFocus
                            required
                        />
                        {showUrgentAlert && (
                            <div className="mt-2 flex items-center gap-2 text-red-600 text-xs font-bold">
                                <AlertTriangle className="w-4 h-4" />
                                This matches your urgent tracking number!
                            </div>
                        )}
                    </div>

                    {/* Carrier */}
                    <div>
                        <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                            Carrier
                        </label>
                        <select
                            value={carrier}
                            onChange={(e) => setCarrier(e.target.value)}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                        >
                            <option value="">Auto-detect</option>
                            <option value="UPS">UPS</option>
                            <option value="FedEx">FedEx</option>
                            <option value="USPS">USPS</option>
                            <option value="DHL">DHL</option>
                            <option value="Amazon">Amazon</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>

                    {/* Order Number - Optional */}
                    <div>
                        <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                            Order Number (Optional)
                        </label>
                        <input
                            type="text"
                            value={orderNumber}
                            onChange={(e) => setOrderNumber(e.target.value)}
                            placeholder="Optional..."
                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                        />
                    </div>

                    {/* Notes */}
                    <div>
                        <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                            Notes
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Add any notes..."
                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs min-h-[60px] outline-none focus:ring-2 focus:ring-blue-500 resize-none text-gray-900"
                        />
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={createTaskMutation.isPending || !trackingNumber.trim()}
                        className={`w-full py-3 rounded-xl font-black text-sm uppercase tracking-widest transition-all shadow-lg ${
                            showUrgentAlert
                                ? 'bg-red-600 hover:bg-red-700 shadow-red-600/20 text-white'
                                : 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20 text-white'
                        } disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none disabled:cursor-not-allowed`}
                    >
                        {createTaskMutation.isPending ? 'Adding...' : showUrgentAlert ? '⚠️ Add Urgent Shipment' : 'Add to Receiving'}
                    </button>
                </form>

                {/* Urgent Tracking Number Settings */}
                <div className="pt-4 border-t border-gray-100">
                    <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">
                        Urgent Tracking Alert
                    </div>
                    {urgentTracking ? (
                        <div className="flex items-center justify-between gap-2 p-2 bg-red-50 border border-red-100 rounded-lg">
                            <div className="flex-1">
                                <div className="text-xs font-mono text-red-600">{urgentTracking}</div>
                            </div>
                            <button
                                onClick={() => {
                                    localStorage.removeItem('urgentTrackingNumber');
                                    setUrgentTracking(null);
                                }}
                                className="p-1 text-red-600 hover:text-red-700 transition-all"
                                title="Remove urgent tracking"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => {
                                const tracking = prompt('Enter urgent tracking number:');
                                if (tracking) {
                                    localStorage.setItem('urgentTrackingNumber', tracking);
                                    setUrgentTracking(tracking);
                                }
                            }}
                            className="w-full py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-all"
                        >
                            + Set Urgent Tracking
                        </button>
                    )}
                    <p className="text-[8px] text-gray-400 mt-2">
                        Set a tracking number to get alerted when it arrives
                    </p>
                </div>
            </div>
        </div>
    );
}

