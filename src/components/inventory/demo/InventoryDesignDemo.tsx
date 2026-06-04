'use client';

import { useState } from 'react';
import { cn } from '@/utils/_cn';
import { 
    LayoutGrid,
    History,
    CheckCircle2
} from 'lucide-react';

// Variant Components
import { VariantTriage } from './variants/VariantTriage';
import { VariantPulse } from './variants/VariantPulse';

type DemoVariant = 'triage' | 'pulse';

interface VariantConfig {
    id: DemoVariant;
    name: string;
    description: string;
    icon: any;
}

const VARIANTS: VariantConfig[] = [
    { id: 'triage', name: 'The Triage', description: 'Advanced Kanban exception sorting & resolution', icon: LayoutGrid },
    { id: 'pulse', name: 'The Pulse', description: 'Deep lifecycle custody tracking & event history', icon: History },
];

export function InventoryDesignDemo() {
    const [activeVariant, setActiveVariant] = useState<DemoVariant>('triage');
    const [selectedVariant, setSelectedVariant] = useState<DemoVariant | null>(null);

    const renderVariant = () => {
        switch (activeVariant) {
            case 'triage': return <VariantTriage />;
            case 'pulse': return <VariantPulse />;
            default: return <VariantTriage />;
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col bg-white">
            {/* Top Cherry-Picker Navigation */}
            <header className="sticky top-0 z-50 flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white/95 px-6 backdrop-blur-sm">
                <div className="flex items-center gap-4">
                    <h1 className="text-sm font-black uppercase tracking-[0.2em] text-gray-900">
                        Inventory <span className="text-blue-600">Design Focus</span>
                    </h1>
                    <div className="h-4 w-px bg-gray-200" />
                    <nav className="flex items-center gap-1">
                        {VARIANTS.map((v) => {
                            const Icon = v.icon;
                            const active = activeVariant === v.id;
                            return (
                                <button
                                    key={v.id}
                                    onClick={() => setActiveVariant(v.id)}
                                    className={cn(
                                        "flex items-center gap-2 rounded-lg px-3 py-1.5 transition-all",
                                        active 
                                            ? "bg-gray-900 text-white shadow-md" 
                                            : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                                    )}
                                >
                                    <Icon className="h-4 w-4" />
                                    <span className="text-xs font-bold uppercase tracking-wider">{v.name}</span>
                                </button>
                            );
                        })}
                    </nav>
                </div>

                <div className="flex items-center gap-3">
                    <div className="text-right">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Selected Concept</p>
                        <p className="text-xs font-bold text-gray-900">{VARIANTS.find(v => v.id === activeVariant)?.description}</p>
                    </div>
                    <button
                        onClick={() => setSelectedVariant(activeVariant)}
                        className={cn(
                            "flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all active:scale-95",
                            selectedVariant === activeVariant
                                ? "bg-emerald-600 text-white shadow-emerald-200 shadow-lg"
                                : "bg-blue-600 text-white shadow-blue-200 shadow-lg hover:bg-blue-700"
                        )}
                    >
                        {selectedVariant === activeVariant ? (
                            <>
                                <CheckCircle2 className="h-4 w-4" />
                                Winner Picked
                            </>
                        ) : (
                            "Select This Architecture"
                        )}
                    </button>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 overflow-hidden">
                {renderVariant()}
            </main>
        </div>
    );
}
