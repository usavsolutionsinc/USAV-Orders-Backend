'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, BarChart3, TrendingUp, Package, AlertCircle } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

export default function Sidebar() {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <>
            <AnimatePresence>
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 280, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="bg-gray-50 border-r border-gray-200 overflow-hidden flex-shrink-0"
                    >
                        <div className="p-4 h-full overflow-y-auto">
                            <h2 className="text-lg font-bold text-gray-900 mb-4">KPI Dashboard</h2>
                            
                            {/* Mock KPI Cards */}
                            <div className="space-y-4">
                                <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-sm font-semibold text-gray-700">Daily Orders</h3>
                                        <BarChart3 className="w-4 h-4 text-blue-500" />
                                    </div>
                                    <p className="text-2xl font-bold text-gray-900">127</p>
                                    <p className="text-xs text-green-600 mt-1">↑ 12% from yesterday</p>
                                </div>

                                <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-sm font-semibold text-gray-700">Processing Time</h3>
                                        <TrendingUp className="w-4 h-4 text-green-500" />
                                    </div>
                                    <p className="text-2xl font-bold text-gray-900">4.2h</p>
                                    <p className="text-xs text-green-600 mt-1">↓ 8% faster</p>
                                </div>

                                <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-sm font-semibold text-gray-700">Stock Items</h3>
                                        <Package className="w-4 h-4 text-purple-500" />
                                    </div>
                                    <p className="text-2xl font-bold text-gray-900">1,234</p>
                                    <p className="text-xs text-gray-600 mt-1">In warehouse</p>
                                </div>

                                <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-sm font-semibold text-gray-700">Low Stock Alerts</h3>
                                        <AlertCircle className="w-4 h-4 text-orange-500" />
                                    </div>
                                    <p className="text-2xl font-bold text-gray-900">8</p>
                                    <p className="text-xs text-orange-600 mt-1">Requires attention</p>
                                </div>

                                {/* Mock Chart */}
                                <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
                                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Weekly Trend</h3>
                                    <div className="h-32 flex items-end justify-between gap-1">
                                        {[45, 62, 38, 71, 55, 83, 67].map((height, i) => (
                                            <div key={i} className="flex-1 bg-blue-500 rounded-t opacity-70 hover:opacity-100 transition-opacity" style={{ height: `${height}%` }} />
                                        ))}
                                    </div>
                                    <div className="flex justify-between mt-2 text-xs text-gray-500">
                                        <span>Mon</span>
                                        <span>Sun</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>

            <button
                onClick={() => setIsOpen(!isOpen)}
                className="fixed left-0 top-1/2 -translate-y-1/2 bg-gray-900 text-white p-2 rounded-r-md shadow-lg hover:bg-gray-700 transition-colors z-50"
                style={{ marginLeft: isOpen ? '280px' : '0' }}
            >
                {isOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
        </>
    );
}

