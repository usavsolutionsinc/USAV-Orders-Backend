'use client';

import { useState } from 'react';
import { StaffManagementTab } from '@/components/admin/StaffManagementTab';
import { ConnectionsManagementTab } from '@/components/admin/ConnectionsManagementTab';
import { OrdersManagementTab } from '@/components/admin/OrdersManagementTab';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'staff' | 'orders' | 'connections'>('orders');

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 relative">
      <div className="max-w-4xl mx-auto p-8 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter text-gray-900">Management</h1>
            <p className="text-[10px] font-bold text-blue-600 uppercase tracking-[0.4em] mt-1">Control Center</p>
          </div>
          <div className="flex gap-2 bg-white p-1 rounded-2xl border border-gray-200 shadow-sm">
            <button
              onClick={() => setActiveTab('orders')}
              className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                activeTab === 'orders'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              Orders
            </button>
            <button
              onClick={() => setActiveTab('staff')}
              className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                activeTab === 'staff'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              Staff
            </button>
            <button
              onClick={() => setActiveTab('connections')}
              className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                activeTab === 'connections'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              Connections
            </button>
          </div>
        </header>

        <div className="grid gap-6">
          {activeTab === 'staff' ? (
            <StaffManagementTab />
          ) : activeTab === 'connections' ? (
            <ConnectionsManagementTab />
          ) : (
            <OrdersManagementTab />
          )}
        </div>
      </div>
    </div>
  );
}
