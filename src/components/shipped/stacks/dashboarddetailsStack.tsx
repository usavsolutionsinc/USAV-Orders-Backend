'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Wrench } from '@/components/Icons';
import { ShippedDetailsPanelContent } from '../ShippedDetailsPanelContent';
import { DetailsStackProps } from './types';

interface Staff {
  id: number;
  name: string;
  role: string;
  active: boolean;
}

export function DashboardDetailsStack({
  shipped,
  durationData,
  copiedAll,
  onCopyAll,
  onUpdate
}: DetailsStackProps) {
  const [testerId, setTesterId] = useState<string>('0');
  const [packerId, setPackerId] = useState<string>('0');
  const [isSavingTester, setIsSavingTester] = useState(false);
  const [isSavingPacker, setIsSavingPacker] = useState(false);

  const { data: staff = [] } = useQuery<Staff[]>({
    queryKey: ['staff'],
    queryFn: async () => {
      const res = await fetch('/api/staff?active=false');
      if (!res.ok) throw new Error('Failed to fetch staff');
      return res.json();
    }
  });

  useEffect(() => {
    setTesterId(shipped.tester_id ? String(shipped.tester_id) : '0');
    setPackerId(shipped.packer_id ? String(shipped.packer_id) : '0');
  }, [shipped.id, shipped.tester_id, shipped.packer_id]);

  const updateAssignment = async (payload: { testerId?: number; packerId?: number }) => {
    const res = await fetch('/api/orders/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: shipped.id,
        ...payload
      })
    });

    if (!res.ok) {
      throw new Error('Failed to update assignment');
    }

    onUpdate?.();
  };

  const activeTechnicians = staff.filter((member) => member.active && member.role === 'technician');
  const activePackers = staff.filter((member) => member.active && member.role === 'packer');

  return (
    <>
      <section className="mx-8 mb-2 mt-4 space-y-6 rounded-[2rem] border border-gray-200 bg-white p-6 shadow-sm">
        <div className="space-y-1">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">Order Assignment</h3>
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Update tester_id and packer_id</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
              <Wrench className="h-3.5 w-3.5 text-blue-600" />
              Technician
            </label>
            <select
              value={testerId}
              onChange={async (e) => {
                const nextValue = e.target.value;
                setTesterId(nextValue);
                setIsSavingTester(true);
                try {
                  await updateAssignment({ testerId: Number(nextValue) });
                } catch (error) {
                  console.error(error);
                } finally {
                  setIsSavingTester(false);
                }
              }}
              disabled={isSavingTester}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold text-gray-900 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
            >
              <option value="0">Unassigned</option>
              {activeTechnicians.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
              <Package className="h-3.5 w-3.5 text-blue-600" />
              Packer
            </label>
            <select
              value={packerId}
              onChange={async (e) => {
                const nextValue = e.target.value;
                setPackerId(nextValue);
                setIsSavingPacker(true);
                try {
                  await updateAssignment({ packerId: Number(nextValue) });
                } catch (error) {
                  console.error(error);
                } finally {
                  setIsSavingPacker(false);
                }
              }}
              disabled={isSavingPacker}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold text-gray-900 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
            >
              <option value="0">Unassigned</option>
              {activePackers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <ShippedDetailsPanelContent
        shipped={shipped}
        durationData={durationData}
        copiedAll={copiedAll}
        onCopyAll={onCopyAll}
        showPackingPhotos={false}
        showPackingInformation={false}
        showTestingInformation={false}
      />
    </>
  );
}
