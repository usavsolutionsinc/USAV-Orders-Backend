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
            <div className="h-12 w-full bg-white/5 rounded-xl animate-pulse" />
        );
    }

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between gap-3 px-5 py-3 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/[0.08] hover:border-white/20 transition-all"
            >
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-black">
                        {selectedStaff ? selectedStaff.name.substring(0, 2).toUpperCase() : '?'}
                    </div>
                    <div className="text-left">
                        <div className="text-sm font-black text-white">
                            {selectedStaff ? selectedStaff.name : 'Select Staff Member'}
                        </div>
                        {selectedStaff?.employee_id && (
                            <div className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">
                                ID: {selectedStaff.employee_id}
                            </div>
                        )}
                    </div>
                </div>
                <svg 
                    className={`w-4 h-4 text-white/40 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <>
                    <div 
                        className="fixed inset-0 z-10" 
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-20 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="p-2 space-y-1">
                            {staff.map((member) => (
                                <button
                                    key={member.id}
                                    onClick={() => {
                                        onSelect(member.id, member.name);
                                        setIsOpen(false);
                                    }}
                                    className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl hover:bg-white/5 transition-all group"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-black">
                                            {member.name.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div className="text-left">
                                            <div className="text-sm font-bold text-white">
                                                {member.name}
                                            </div>
                                            {member.employee_id && (
                                                <div className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">
                                                    ID: {member.employee_id}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {selectedStaffId === member.id && (
                                        <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                                            <Check className="w-3 h-3 text-white" />
                                        </div>
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

