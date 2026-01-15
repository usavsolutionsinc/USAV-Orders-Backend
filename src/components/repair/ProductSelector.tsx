'use client';

import React, { useState } from 'react';
import { ChevronRight } from '../Icons';

interface ProductSelectorProps {
    onSelect: (product: { type: string; model: string }) => void;
    selectedProduct: { type: string; model: string } | null;
}

const WAVE_SERIES = ['Series I', 'Series II', 'Series III', 'Series IV'];
const ACOUSTIMASS_MODELS = ['CD-3000', 'Series II'];

export function ProductSelector({ onSelect, selectedProduct }: ProductSelectorProps) {
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
    const [otherModelText, setOtherModelText] = useState('');

    const handleCategoryClick = (category: string) => {
        if (category === 'Other') {
            setExpandedCategory(expandedCategory === category ? null : category);
        } else {
            setExpandedCategory(expandedCategory === category ? null : category);
        }
    };

    const handleModelSelect = (type: string, model: string) => {
        onSelect({ type, model });
        setExpandedCategory(null);
    };

    const handleOtherSubmit = () => {
        if (otherModelText.trim()) {
            onSelect({ type: 'Other', model: otherModelText.trim() });
            setExpandedCategory(null);
            setOtherModelText('');
        }
    };

    const isSelected = (type: string, model?: string) => {
        if (!selectedProduct) return false;
        if (model) {
            return selectedProduct.type === type && selectedProduct.model === model;
        }
        return selectedProduct.type === type;
    };

    return (
        <div className="space-y-3">
            <h3 className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-3">
                Select Product
            </h3>

            {/* Bose Wave Music System */}
            <div className="space-y-2">
                <button
                    onClick={() => handleCategoryClick('Wave')}
                    className={`w-full p-4 rounded-xl border-2 transition-all text-left flex items-center justify-between group ${
                        selectedProduct?.type === 'Wave'
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-gray-50 border-gray-200 text-gray-900 hover:border-blue-500'
                    }`}
                >
                    <div>
                        <div className="text-sm font-black uppercase tracking-tight">
                            Bose Wave Music System
                        </div>
                        {selectedProduct?.type === 'Wave' && (
                            <div className="text-[10px] font-semibold mt-1 opacity-90">
                                {selectedProduct.model}
                            </div>
                        )}
                    </div>
                    <ChevronRight 
                        className={`w-4 h-4 transition-transform ${
                            expandedCategory === 'Wave' ? 'rotate-90' : ''
                        }`} 
                    />
                </button>

                {expandedCategory === 'Wave' && (
                    <div className="ml-4 space-y-2 animate-in slide-in-from-top-2">
                        {WAVE_SERIES.map((series) => (
                            <button
                                key={series}
                                onClick={() => handleModelSelect('Wave', series)}
                                className={`w-full p-3 rounded-lg transition-all text-left ${
                                    isSelected('Wave', series)
                                        ? 'bg-blue-500 text-white'
                                        : 'bg-white border border-gray-200 text-gray-900 hover:bg-gray-50'
                                }`}
                            >
                                <div className="text-xs font-bold uppercase tracking-wide">
                                    {series}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Acoustimass Music System */}
            <div className="space-y-2">
                <button
                    onClick={() => handleCategoryClick('Acoustimass')}
                    className={`w-full p-4 rounded-xl border-2 transition-all text-left flex items-center justify-between group ${
                        selectedProduct?.type === 'Acoustimass'
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-gray-50 border-gray-200 text-gray-900 hover:border-blue-500'
                    }`}
                >
                    <div>
                        <div className="text-sm font-black uppercase tracking-tight">
                            Acoustimass Music System
                        </div>
                        {selectedProduct?.type === 'Acoustimass' && (
                            <div className="text-[10px] font-semibold mt-1 opacity-90">
                                {selectedProduct.model}
                            </div>
                        )}
                    </div>
                    <ChevronRight 
                        className={`w-4 h-4 transition-transform ${
                            expandedCategory === 'Acoustimass' ? 'rotate-90' : ''
                        }`} 
                    />
                </button>

                {expandedCategory === 'Acoustimass' && (
                    <div className="ml-4 space-y-2 animate-in slide-in-from-top-2">
                        {ACOUSTIMASS_MODELS.map((model) => (
                            <button
                                key={model}
                                onClick={() => handleModelSelect('Acoustimass', model)}
                                className={`w-full p-3 rounded-lg transition-all text-left ${
                                    isSelected('Acoustimass', model)
                                        ? 'bg-blue-500 text-white'
                                        : 'bg-white border border-gray-200 text-gray-900 hover:bg-gray-50'
                                }`}
                            >
                                <div className="text-xs font-bold uppercase tracking-wide">
                                    {model}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Other (Manual Entry) */}
            <div className="space-y-2">
                <button
                    onClick={() => handleCategoryClick('Other')}
                    className={`w-full p-4 rounded-xl border-2 transition-all text-left flex items-center justify-between group ${
                        selectedProduct?.type === 'Other'
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-gray-50 border-gray-200 text-gray-900 hover:border-blue-500'
                    }`}
                >
                    <div>
                        <div className="text-sm font-black uppercase tracking-tight">
                            Other (Manual Entry)
                        </div>
                        {selectedProduct?.type === 'Other' && (
                            <div className="text-[10px] font-semibold mt-1 opacity-90">
                                {selectedProduct.model}
                            </div>
                        )}
                    </div>
                    <ChevronRight 
                        className={`w-4 h-4 transition-transform ${
                            expandedCategory === 'Other' ? 'rotate-90' : ''
                        }`} 
                    />
                </button>

                {expandedCategory === 'Other' && (
                    <div className="ml-4 space-y-2 animate-in slide-in-from-top-2">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={otherModelText}
                                onChange={(e) => setOtherModelText(e.target.value)}
                                placeholder="Enter model name..."
                                className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                onKeyPress={(e) => e.key === 'Enter' && handleOtherSubmit()}
                            />
                            <button
                                onClick={handleOtherSubmit}
                                disabled={!otherModelText.trim()}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg text-xs font-bold uppercase tracking-wide transition-all disabled:cursor-not-allowed"
                            >
                                Add
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
