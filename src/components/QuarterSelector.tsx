'use client';

import { motion } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronRight } from './Icons';

export const QUARTER_OPTIONS = [
  { key: 'q4-25', label: "Q4 25'", sheetId: '1xzGV0cm7WEwX_vx8N-icA8SZQllNq9APhhILzCahww0' },
  { key: 'q3-25', label: "Q3 25'", sheetId: '1RGOnktpMew-Hsu5EoUVp2GSZwDxG-MKZYnEUph0W9GU' },
  { key: 'q2-25', label: "Q2 25'", sheetId: '1a8Xddl0PDcvlhjcraRCcFrkyPfvDi_pXd6BKRLTuMFs' },
] as const;

function useSelectedQuarter() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const requestedKey = searchParams.get('quarter');
  const selectedQuarter = QUARTER_OPTIONS.find((quarter) => quarter.key === requestedKey) || QUARTER_OPTIONS[0];

  const setSelectedQuarter = (quarterKey: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (quarterKey === QUARTER_OPTIONS[0].key) {
      nextParams.delete('quarter');
    } else {
      nextParams.set('quarter', quarterKey);
    }
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname || '/previous-quarters');
  };

  return { selectedQuarter, setSelectedQuarter };
}

export function QuarterSidebar({ hideSectionHeader = false }: { hideSectionHeader?: boolean }) {
  const { selectedQuarter, setSelectedQuarter } = useSelectedQuarter();

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
        delayChildren: 0.05,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -20, filter: 'blur(4px)' },
    visible: {
      opacity: 1,
      x: 0,
      filter: 'blur(0px)',
      transition: { type: 'spring', damping: 25, stiffness: 350, mass: 0.5 },
    },
  };

  return (
    <motion.div initial="hidden" animate="visible" variants={containerVariants} className="h-full overflow-y-auto bg-white px-6 py-4">
      {!hideSectionHeader ? (
        <motion.header variants={itemVariants} className="mb-6">
          <h2 className="text-2xl font-black tracking-tighter text-gray-900 uppercase">Quarters</h2>
          <p className="text-[10px] font-bold text-blue-600 uppercase tracking-[0.2em] mt-1">Archive Access</p>
        </motion.header>
      ) : null}

      <motion.div variants={itemVariants} className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Currently Viewing</p>
        <p className="mt-2 text-lg font-black text-gray-900">{selectedQuarter.label}</p>
      </motion.div>

      <motion.div variants={itemVariants} className="space-y-2">
        {QUARTER_OPTIONS.map((quarter) => {
          const isActive = selectedQuarter.key === quarter.key;
          return (
            <button
              key={quarter.key}
              type="button"
              onClick={() => setSelectedQuarter(quarter.key)}
              className={`w-full flex items-center justify-between gap-3 px-4 py-4 rounded-2xl text-left transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-blue-200'
              }`}
            >
              <span className={`text-sm font-black tracking-tight ${isActive ? 'text-white' : 'text-gray-900'}`}>{quarter.label}</span>
              <ChevronRight className={`w-4 h-4 ${isActive ? 'text-white' : 'text-gray-400'}`} />
            </button>
          );
        })}
      </motion.div>
    </motion.div>
  );
}

export default function QuarterSelector() {
  const { selectedQuarter } = useSelectedQuarter();
  const iframeUrl = `https://docs.google.com/spreadsheets/d/${selectedQuarter.sheetId}/edit?rm=minimal&single=true&widget=false`;

  return (
    <div className="flex h-full w-full bg-white overflow-hidden">
      <div className="flex-1 overflow-hidden w-full h-full relative">
        <iframe
          key={selectedQuarter.sheetId}
          src={iframeUrl}
          className="w-full h-full border-none opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]"
          allow="clipboard-read; clipboard-write"
        />
      </div>

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.99); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
