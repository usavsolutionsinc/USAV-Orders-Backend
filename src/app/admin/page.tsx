'use client';

import { useRef, useState } from 'react';
import { StaffManagementTab } from '@/components/admin/StaffManagementTab';
import { ConnectionsManagementTab } from '@/components/admin/ConnectionsManagementTab';
import { GoalsAnalyticsTab } from '@/components/admin/GoalsAnalyticsTab';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'staff' | 'goals' | 'connections'>('goals');
  const [isShipStationSyncing, setIsShipStationSyncing] = useState(false);
  const [shipStationStatus, setShipStationStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const shipStationFileInputRef = useRef<HTMLInputElement>(null);

  const handleShipStationSync = () => {
    shipStationFileInputRef.current?.click();
  };

  const handleShipStationFileChange = async (file: File | null) => {
    if (!file) return;

    setIsShipStationSyncing(true);
    setShipStationStatus(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/google-sheets/sync-shipstation-orders', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || data?.message || 'ShipStation sync failed');
      }
      setShipStationStatus({
        type: 'success',
        message: data.message || 'ShipStation sync completed successfully',
      });
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
    } catch (error: any) {
      setShipStationStatus({
        type: 'error',
        message: error?.message || 'ShipStation sync failed',
      });
    } finally {
      if (shipStationFileInputRef.current) {
        shipStationFileInputRef.current.value = '';
      }
      setIsShipStationSyncing(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 relative">
      <div className="max-w-4xl mx-auto p-8 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter text-gray-900">Management</h1>
            <p className="text-[10px] font-bold text-blue-600 uppercase tracking-[0.4em] mt-1">Control Center</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={shipStationFileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => handleShipStationFileChange(e.target.files?.[0] || null)}
            />
            <button
              onClick={handleShipStationSync}
              disabled={isShipStationSyncing}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            >
              {isShipStationSyncing ? 'Syncing...' : 'Sync ShipStation Orders'}
            </button>
            <div className="flex gap-2 bg-white p-1 rounded-2xl border border-gray-200 shadow-sm">
            <button
              onClick={() => setActiveTab('goals')}
              className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${
                activeTab === 'goals'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              Goals
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
          </div>
        </header>

        {shipStationStatus && (
          <div
            className={`rounded-xl border px-4 py-3 text-[10px] font-black uppercase tracking-widest ${
              shipStationStatus.type === 'success'
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            {shipStationStatus.message}
          </div>
        )}

        <div className="grid gap-6">
          {activeTab === 'staff' ? (
            <StaffManagementTab />
          ) : activeTab === 'connections' ? (
            <ConnectionsManagementTab />
          ) : (
            <GoalsAnalyticsTab />
          )}
        </div>
      </div>
    </div>
  );
}
