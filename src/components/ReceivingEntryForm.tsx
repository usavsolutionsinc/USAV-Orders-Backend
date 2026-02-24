'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Package } from './Icons';

export default function ReceivingEntryForm() {
    const queryClient = useQueryClient();
    const [trackingNumber, setTrackingNumber] = useState('');
    const [orderNumber, setOrderNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [carrier, setCarrier] = useState('');

    const createTaskMutation = useMutation({
        mutationFn: async () => {
            // 1. Add to receiving_tasks table
            const taskRes = await fetch('/api/receiving-tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trackingNumber,
                    orderNumber: orderNumber || null,
                    notes: notes || null,
                }),
            });

            if (!taskRes.ok) throw new Error('Failed to create task');
            const task = await taskRes.json();

            // 2. Add to receiving logs table
            const entryRes = await fetch('/api/receiving-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trackingNumber,
                    carrier: carrier || 'Unknown',
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
            <div className="space-y-4">
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
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none transition-all text-gray-900 focus:ring-2 focus:ring-blue-500"
                            autoFocus
                            required
                        />
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
                        className="w-full py-3 rounded-xl font-black text-sm uppercase tracking-widest transition-all shadow-lg bg-blue-600 hover:bg-blue-700 shadow-blue-600/20 text-white disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none disabled:cursor-not-allowed"
                    >
                        {createTaskMutation.isPending ? 'Adding...' : 'Add to Receiving'}
                    </button>
                </form>
            </div>
        </div>
    );
}
