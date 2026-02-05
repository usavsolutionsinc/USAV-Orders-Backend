'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from './Icons';

interface Staff {
    id: number;
    name: string;
    role: string;
    employee_id: string | null;
    active: boolean;
}

interface StaffSelectorProps {
    role: 'technician' | 'packer';
    selectedStaffId: number | null;
    onSelect: (staffId: number, staffName: string) => void;
}

export default function StaffSelector({ role, selectedStaffId, onSelect }: StaffSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);

    const { data: staff = [], isLoading } = useQuery<Staff[]>({
        queryKey: ['staff', role],
        queryFn: async () => {
            const res = await fetch(`/api/staff?role=${role}&active=true`);
            if (!res.ok) throw new Error('Failed to fetch staff');
            return res.json();
        },
    });

    const selectedStaff = staff.find(s => s.id === selectedStaffId);

    if (isLoading) {
        return (
            <div className="h-8 w-32 bg-gray-100 rounded-lg animate-pulse" />
        );
    }

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
            >
                <span className="text-xs font-black text-gray-900 tracking-tight">
                    {selectedStaff ? selectedStaff.name : 'Select Staff'}
                </span>
                <svg 
                    className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <>
                    <div 
                        className="fixed inset-0 z-[60]" 
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute top-full left-0 mt-1 min-w-[160px] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-[70] animate-in fade-in slide-in-from-top-1 duration-200">
                        <div className="p-1 space-y-1">
                            {staff.map((member) => (
                                <button
                                    key={member.id}
                                    onClick={() => {
                                        onSelect(member.id, member.name);
                                        setIsOpen(false);
                                    }}
                                    className="w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-all group text-left"
                                >
                                    <span className={`text-[11px] font-bold ${selectedStaffId === member.id ? 'text-blue-600' : 'text-gray-700'}`}>
                                        {member.name}
                                    </span>
                                    {selectedStaffId === member.id && (
                                        <Check className="w-3 h-3 text-blue-600" />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
