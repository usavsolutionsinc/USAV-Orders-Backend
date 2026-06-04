'use client';

import { useState } from 'react';
import { FilterRefinementBar, type FilterRefinement } from '@/design-system/components';
import { Bay } from './sections';
import { Truck, Package, Clock, ShieldCheck, AlertCircle } from '@/components/Icons';

export function FilterBarSection() {
  // Refinement Bar State
  const [activeFilters, setActiveFilters] = useState<string[]>(['UPS', 'Delivered']);
  const refinements: FilterRefinement[] = activeFilters.map(f => ({
    id: f,
    label: f,
    onRemove: () => setActiveFilters(prev => prev.filter(x => x !== f))
  }));

  const CARRIERS = [
    { id: 'UPS', icon: Truck },
    { id: 'USPS', icon: Truck },
    { id: 'FedEx', icon: Truck },
    { id: 'DHL', icon: Truck },
  ];

  const STATUSES = [
    { id: 'Pending', icon: Clock },
    { id: 'Accepted', icon: Package },
    { id: 'Delivered', icon: ShieldCheck },
    { id: 'Exception', icon: AlertCircle },
  ];

  return (
    <div className="space-y-12">
      <Bay
        title="2026 Filter Refinement Bar"
        promote="@/design-system/components/FilterRefinementBar"
        tag="standard"
        caption="The definitive filter pattern: A prominent glassmorphic trigger with spring-press feedback. Active criteria are surfaced as plain refinement chips below for maximum clarity."
      >
        <div className="rounded-[32px] border border-border-soft bg-surface-card p-8 max-w-2xl shadow-sm">
          <FilterRefinementBar
            label="Shipment Refinements"
            refinements={refinements}
            onClearAll={() => setActiveFilters([])}
            renderDropdown={(onClose) => (
              <div className="space-y-8">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400">Carrier Network</p>
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Multi-select</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {CARRIERS.map(({ id, icon: Icon }) => {
                      const active = activeFilters.includes(id);
                      return (
                        <button 
                          key={id}
                          onClick={() => setActiveFilters(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                          className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-[13px] font-bold transition-all ${
                            active 
                              ? 'border-blue-500 bg-blue-500 text-white shadow-md shadow-blue-500/20' 
                              : 'border-gray-100 bg-gray-50/50 text-gray-600 hover:border-gray-200 hover:bg-white hover:shadow-sm'
                          }`}
                        >
                          <Icon className={`h-4 w-4 ${active ? 'text-white' : 'text-gray-400'}`} />
                          {id}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400">Shipment Status</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {STATUSES.map(({ id, icon: Icon }) => {
                      const active = activeFilters.includes(id);
                      return (
                        <button 
                          key={id}
                          onClick={() => setActiveFilters(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                          className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-[13px] font-bold transition-all ${
                            active 
                              ? 'border-blue-500 bg-blue-500 text-white shadow-md shadow-blue-500/20' 
                              : 'border-gray-100 bg-gray-50/50 text-gray-600 hover:border-gray-200 hover:bg-white hover:shadow-sm'
                          }`}
                        >
                          <Icon className={`h-4 w-4 ${active ? 'text-white' : 'text-gray-400'}`} />
                          {id}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={onClose}
                    className="w-full rounded-2xl bg-gray-900 py-4 text-[14px] font-black uppercase tracking-widest text-white shadow-xl shadow-gray-900/20 transition-all hover:bg-black hover:scale-[1.02] active:scale-[0.98]"
                  >
                    Apply Refinements
                  </button>
                </div>
              </div>
            )}
          />

          <div className="mt-12 h-40 rounded-2xl border-2 border-dashed border-gray-100 flex items-center justify-center text-gray-300 font-medium italic">
            Dashboard content area
          </div>
        </div>
      </Bay>
    </div>
  );
}
