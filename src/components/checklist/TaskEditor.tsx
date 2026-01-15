'use client';

import React, { useState, useEffect } from 'react';
import type { ChecklistItem } from '../../queries/useChecklistQueries';

interface TaskEditorProps {
    task?: ChecklistItem;
    onSave: (data: TaskFormData) => void;
    onCancel: () => void;
    isLoading?: boolean;
}

export interface TaskFormData {
    id?: number;
    title: string;
    description: string;
    order_number: string;
    tracking_number: string;
}

/**
 * Task editor form for creating or editing tasks
 */
export function TaskEditor({ task, onSave, onCancel, isLoading = false }: TaskEditorProps) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [orderNumber, setOrderNumber] = useState('');
    const [trackingNumber, setTrackingNumber] = useState('');

    useEffect(() => {
        if (task) {
            setTitle(task.title);
            setDescription(task.description || '');
            setOrderNumber(task.order_number || '');
            setTrackingNumber(task.tracking_number || '');
        }
    }, [task]);

    const handleSave = () => {
        if (title.trim()) {
            onSave({
                ...(task && { id: task.id }),
                title,
                description,
                order_number: orderNumber,
                tracking_number: trackingNumber,
            });
        }
    };

    return (
        <div className="space-y-3 bg-gray-50 p-4 rounded-2xl border border-blue-200 animate-in fade-in slide-in-from-top-2 shadow-sm">
            <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold focus:border-blue-500 outline-none text-gray-900"
                placeholder="Task title..."
                autoFocus
            />
            <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-[10px] min-h-[60px] outline-none text-gray-600"
                placeholder="Details..."
            />
            <div className="grid grid-cols-2 gap-2">
                <input
                    type="text"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-[9px] font-mono outline-none text-gray-900"
                    placeholder="Order #"
                />
                <input
                    type="text"
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-[9px] font-mono outline-none text-gray-900"
                    placeholder="Tracking #"
                />
            </div>
            <div className="flex gap-2">
                <button 
                    onClick={handleSave} 
                    disabled={isLoading}
                    className="flex-1 py-2 bg-blue-600 rounded-xl text-[10px] font-black uppercase tracking-wider text-white shadow-lg shadow-blue-100 disabled:opacity-50"
                >
                    {task ? 'Save' : 'Add'}
                </button>
                <button 
                    onClick={onCancel} 
                    disabled={isLoading}
                    className="flex-1 py-2 bg-gray-200 rounded-xl text-[10px] font-black uppercase text-gray-600 disabled:opacity-50"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
