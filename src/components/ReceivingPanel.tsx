'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Loader2, Search } from './Icons';
import { SearchBar } from './ui/SearchBar';
import { motion } from 'framer-motion';
import { formatDatePST, formatTimePST } from '@/lib/timezone';
import { invalidateReceivingCache } from '@/lib/receivingCache';

type ReceivingMode = 'INCOMING' | 'RETURN';

type SearchResult = {
  id: string;
  timestamp: string;
  tracking: string;
  status: string;
  count: number;
};

type StaffOption = {
  id: number;
  name: string;
};

interface ReceivingPanelProps {
  onEntryAdded?: () => void;
  todayCount: number;
  averageTime: string;
  embedded?: boolean;
  hideSectionHeader?: boolean;
}

const CONDITION_OPTIONS = [
  { value: 'BRAND_NEW', label: 'Brand New' },
  { value: 'USED_A', label: 'Used - A' },
  { value: 'USED_B', label: 'Used - B' },
  { value: 'USED_C', label: 'Used - C' },
  { value: 'PARTS', label: 'Parts' },
] as const;

const RETURN_PLATFORM_OPTIONS = [
  { value: 'AMZ', label: 'AMZ' },
  { value: 'EBAY_DRAGONH', label: 'eBay Dragonh' },
  { value: 'EBAY_USAV', label: 'eBay USAV' },
  { value: 'EBAY_MK', label: 'eBay MK' },
  { value: 'FBA', label: 'FBA' },
  { value: 'WALMART', label: 'Walmart' },
  { value: 'ECWID', label: 'Ecwid' },
] as const;

const TARGET_CHANNEL_OPTIONS = [
  { value: '', label: 'No Target Channel' },
  { value: 'ORDERS', label: 'Orders' },
  { value: 'FBA', label: 'FBA' },
] as const;

export default function ReceivingPanel({
  onEntryAdded,
  todayCount,
  averageTime,
  embedded = false,
  hideSectionHeader = false,
}: ReceivingPanelProps) {
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const [trackingNumber, setTrackingNumber] = useState('');
  const [carrier, setCarrier] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [technicians, setTechnicians] = useState<StaffOption[]>([]);

  const [receivingMode, setReceivingMode] = useState<ReceivingMode>('INCOMING');
  const [conditionGrade, setConditionGrade] = useState('BRAND_NEW');
  const [needsTest, setNeedsTest] = useState(false);
  const [assignedTechId, setAssignedTechId] = useState('');
  const [targetChannel, setTargetChannel] = useState('');
  const [returnPlatform, setReturnPlatform] = useState('');
  const [returnReason, setReturnReason] = useState('');

  useEffect(() => {
    const handleFocusScan = () => {
      requestAnimationFrame(() => {
        scanInputRef.current?.focus();
      });
    };
    window.addEventListener('receiving-focus-scan', handleFocusScan as EventListener);
    return () => {
      window.removeEventListener('receiving-focus-scan', handleFocusScan as EventListener);
    };
  }, []);

  useEffect(() => {
    const loadTechs = async () => {
      try {
        const res = await fetch('/api/staff?role=technician&active=true', { cache: 'no-store' });
        if (!res.ok) return;
        const rows = await res.json();
        if (!Array.isArray(rows)) return;
        setTechnicians(
          rows
            .map((row: any) => ({ id: Number(row.id), name: String(row.name || '') }))
            .filter((row: StaffOption) => Number.isFinite(row.id) && row.id > 0 && row.name)
        );
      } catch {
        // no-op
      }
    };

    loadTechs();
  }, []);

  const showReturnFields = receivingMode === 'RETURN';
  const showTechSelector = needsTest;

  const payload = useMemo(() => {
    const techId = Number(assignedTechId);
    return {
      trackingNumber: trackingNumber.trim(),
      carrier: carrier || 'Unknown',
      conditionGrade,
      qaStatus: 'PENDING',
      dispositionCode: 'HOLD',
      isReturn: showReturnFields,
      returnPlatform: showReturnFields ? returnPlatform || null : null,
      returnReason: showReturnFields ? returnReason.trim() || null : null,
      needsTest,
      assignedTechId: showTechSelector && Number.isFinite(techId) && techId > 0 ? techId : null,
      targetChannel: targetChannel || null,
    };
  }, [trackingNumber, carrier, conditionGrade, showReturnFields, returnPlatform, returnReason, needsTest, showTechSelector, assignedTechId, targetChannel]);

  const resetForm = () => {
    setTrackingNumber('');
    setCarrier('');
    setConditionGrade('BRAND_NEW');
    setReceivingMode('INCOMING');
    setNeedsTest(false);
    setAssignedTechId('');
    setTargetChannel('');
    setReturnPlatform('');
    setReturnReason('');
  };

  const handleSubmit = async () => {
    if (!payload.trackingNumber) return;

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/receiving-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to add receiving entry');

      const data = await res.json();
      resetForm();
      invalidateReceivingCache();

      if (data.record) {
        window.dispatchEvent(new CustomEvent('receiving-entry-added', { detail: data.record }));
      }
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      onEntryAdded?.();
      scanInputRef.current?.focus();
    } catch (error) {
      console.error('Error adding receiving entry:', error);
      window.alert('Failed to add receiving entry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSearch = async () => {
    const q = trackingNumber.trim();
    if (!q) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch(`/api/receiving-logs/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
      const data = await res.json();
      setResults(Array.isArray(data.results) ? data.results : []);
    } catch {
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField(null), 1500);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`flex h-full flex-col bg-white ${embedded ? '' : 'border-r border-gray-200'}`}
    >
      {!hideSectionHeader && (
        <div className="flex items-center justify-between border-b border-gray-200 p-6">
          <div>
            <h2 className="text-xl font-black uppercase leading-none tracking-tighter text-gray-900">Receiving</h2>
            <p className="mt-1 text-[9px] font-black uppercase tracking-[0.2em] text-gray-400">QA Intake</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Today</p>
            <p className="text-lg font-black text-blue-600">{todayCount}</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Avg {averageTime}</p>
          </div>
        </div>
      )}

      <div className="border-b border-gray-200 p-4">
        <SearchBar
          inputRef={scanInputRef}
          value={trackingNumber}
          onChange={setTrackingNumber}
          onSearch={handleSubmit}
          placeholder="Scan tracking number..."
          isSearching={isSubmitting}
          variant="blue"
          rightElement={
            <button
              type="button"
              onClick={handleSearch}
              disabled={isSearching || !trackingNumber.trim()}
              className="rounded-2xl bg-emerald-600 p-3 text-white shadow-lg shadow-emerald-600/10 transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
              title="Search logs"
            >
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </button>
          }
        />
      </div>

      <div className="space-y-3 border-b border-gray-200 p-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setReceivingMode('INCOMING')}
            className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
              receivingMode === 'INCOMING' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-500'
            }`}
          >
            Incoming
          </button>
          <button
            type="button"
            onClick={() => setReceivingMode('RETURN')}
            className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
              receivingMode === 'RETURN' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-200 bg-white text-gray-500'
            }`}
          >
            Return
          </button>
        </div>

        <select
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-gray-900 outline-none focus:border-blue-500"
        >
          <option value="">Auto-detect Carrier</option>
          <option value="UPS">UPS</option>
          <option value="FEDEX">FedEx</option>
          <option value="USPS">USPS</option>
          <option value="AMAZON">Amazon</option>
          <option value="DHL">DHL</option>
          <option value="UNIUNI">UniUni</option>
        </select>

        <select
          value={conditionGrade}
          onChange={(e) => setConditionGrade(e.target.value)}
          className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-gray-900 outline-none focus:border-blue-500"
        >
          {CONDITION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {showReturnFields && (
          <>
            <select
              value={returnPlatform}
              onChange={(e) => setReturnPlatform(e.target.value)}
              className="w-full rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-amber-800 outline-none focus:border-amber-400"
            >
              <option value="">Return Platform</option>
              {RETURN_PLATFORM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <textarea
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              placeholder="Return reason (optional)"
              className="min-h-[72px] w-full resize-none rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-gray-900 outline-none focus:border-amber-400"
            />
          </>
        )}

        <div className="space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-700">
            <input type="checkbox" checked={needsTest} onChange={(e) => setNeedsTest(e.target.checked)} />
            Needs Test
          </label>

          {showTechSelector && (
            <select
              value={assignedTechId}
              onChange={(e) => setAssignedTechId(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-900 outline-none focus:border-purple-500"
            >
              <option value="">Assign Tech</option>
              {technicians.map((tech) => (
                <option key={tech.id} value={String(tech.id)}>
                  {tech.name}
                </option>
              ))}
            </select>
          )}

          <select
            value={targetChannel}
            onChange={(e) => setTargetChannel(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-900 outline-none focus:border-purple-500"
          >
            {TARGET_CHANNEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || !trackingNumber.trim()}
          className="w-full rounded-2xl bg-blue-600 py-3 text-[11px] font-black uppercase tracking-widest text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
        >
          {isSubmitting ? 'Saving...' : 'Acknowledge Package'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {results.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Search Results</p>
              <button
                onClick={() => setResults([])}
                className="text-[10px] font-black uppercase tracking-widest text-blue-600 hover:underline"
              >
                Clear
              </button>
            </div>
            {results.map((result) => (
              <div key={result.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[10px] font-mono font-black text-blue-600">{result.tracking}</p>
                  <button
                    onClick={() => copyToClipboard(result.tracking, `tracking-${result.id}`)}
                    className="rounded p-1 hover:bg-gray-200"
                  >
                    {copiedField === `tracking-${result.id}` ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3 text-gray-400" />}
                  </button>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-[8px] font-black uppercase tracking-widest text-gray-500">{result.status || 'Unknown'}</p>
                  <p className="text-[8px] font-bold uppercase tracking-wide text-gray-400">
                    {formatTimePST(result.timestamp)} - {formatDatePST(result.timestamp)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-10 text-center text-[10px] font-black uppercase tracking-widest text-gray-300">No search results</div>
        )}
      </div>
    </motion.div>
  );
}
