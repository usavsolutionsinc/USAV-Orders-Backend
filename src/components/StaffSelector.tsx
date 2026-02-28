'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from './Icons';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

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
    variant?: 'default' | 'boxy';
}

export default function StaffSelector({ role, selectedStaffId, onSelect, variant = 'default' }: StaffSelectorProps) {
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
    const techOrder = ['michael', 'thuc', 'sang', 'cuong'];
    const orderMap = new Map(techOrder.map((name, index) => [name, index]));
    const sortedStaff = [...staff].sort((a, b) => {
        if (role === 'packer') {
            return a.id - b.id;
        }
        const aName = a.name.trim().toLowerCase();
        const bName = b.name.trim().toLowerCase();
        const aRank = orderMap.has(aName) ? (orderMap.get(aName) as number) : Number.MAX_SAFE_INTEGER;
        const bRank = orderMap.has(bName) ? (orderMap.get(bName) as number) : Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) return aRank - bRank;
        return a.name.localeCompare(b.name);
    });
    const selectedTheme = selectedStaff ? getStaffThemeById(selectedStaff.id, role) : null;
    const isBoxy = variant === 'boxy';

    if (isLoading) {
        return (
            <div className="h-8 w-32 bg-gray-100 rounded-lg animate-pulse" />
        );
    }

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm ${
                    isBoxy ? 'px-3 py-3 rounded-none h-full w-full justify-between' : 'px-3 py-1.5 rounded-xl'
                }`}
            >
                <span className={`text-xs font-black tracking-tight ${selectedTheme ? stationThemeColors[selectedTheme].text : 'text-gray-900'}`}>
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
                    <div className={`absolute top-full left-0 mt-1 min-w-[160px] bg-white border border-gray-200 shadow-xl overflow-hidden z-[70] animate-in fade-in slide-in-from-top-1 duration-200 ${
                        isBoxy ? 'rounded-none' : 'rounded-xl'
                    }`}>
                        <div className="p-1 space-y-1">
                            {sortedStaff.map((member) => {
                                const isSelected = selectedStaffId === member.id;
                                const theme = getStaffThemeById(member.id, role);
                                const textClass = stationThemeColors[theme].text;
                                return (
                                    <button
                                        key={member.id}
                                        onClick={() => {
                                            onSelect(member.id, member.name);
                                            setIsOpen(false);
                                        }}
                                        className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-gray-50 transition-all group text-left ${
                                            isBoxy ? 'rounded-none' : 'rounded-lg'
                                        }`}
                                    >
                                        <span className={`text-[11px] font-bold ${textClass}`}>
                                            {member.name}
                                        </span>
                                        {isSelected && (
                                            <Check className={`w-3 h-3 ${textClass}`} />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
