'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Plus } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { TabSwitch } from '@/components/ui/TabSwitch';
import { RepairIntakeForm, type RepairFormData } from '@/components/repair';

type RepairTab = 'active' | 'done';

interface RepairSidebarProps {
  embedded?: boolean;
  hideSectionHeader?: boolean;
}

export function RepairSidebar({ embedded = false, hideSectionHeader = false }: RepairSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showIntakeForm, setShowIntakeForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchValue, setSearchValue] = useState(searchParams.get('search') || '');

  const activeTab: RepairTab = searchParams.get('tab') === 'done' ? 'done' : 'active';

  useEffect(() => {
    setSearchValue(searchParams.get('search') || '');
    if (searchParams.get('new') === 'true') {
      setShowIntakeForm(true);
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete('new');
      const nextSearch = nextParams.toString();
      router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname || '/repair');
    }
  }, [pathname, router, searchParams]);

  const updateParams = (mutate: (params: URLSearchParams) => void) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    mutate(nextParams);
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname || '/repair');
  };

  const handleClearSearch = () => {
    setSearchValue('');
    updateParams((params) => {
      params.delete('search');
    });
  };

  const handleCloseForm = () => {
    setShowIntakeForm(false);
  };

  const handleSubmitForm = async (data: RepairFormData) => {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/repair/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (result.success) {
        setShowIntakeForm(false);
        window.open(`/api/repair-service/print/${result.id}`, '_blank');
      } else {
        alert('Failed to submit repair form. Please try again.');
      }
    } catch (_error) {
      alert('Error submitting repair form. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

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

  const content = showIntakeForm ? (
    <RepairIntakeForm onClose={handleCloseForm} onSubmit={handleSubmitForm} />
  ) : (
    <motion.div initial="hidden" animate="visible" variants={containerVariants} className="px-6 py-4 space-y-6 h-full flex flex-col overflow-y-auto">
      {!hideSectionHeader ? (
        <motion.header variants={itemVariants}>
          <h2 className="text-2xl font-black tracking-tighter text-gray-900 uppercase leading-none">Repairs</h2>
          <p className="text-[10px] font-bold text-orange-600 uppercase tracking-[0.3em] mt-2">USAV Repair Service</p>
        </motion.header>
      ) : null}

      <motion.div variants={itemVariants} className="space-y-4">
        <SearchBar
          value={searchValue}
          onChange={setSearchValue}
          onSearch={() =>
            updateParams((params) => {
              if (searchValue.trim()) {
                params.set('search', searchValue.trim());
              } else {
                params.delete('search');
              }
            })
          }
          onClear={handleClearSearch}
          placeholder="Search repairs..."
          variant="orange"
          rightElement={
            <button
              onClick={() => setShowIntakeForm(true)}
              disabled={isSubmitting}
              className="p-3 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white rounded-2xl transition-all active:scale-95 shadow-lg shadow-gray-900/10 group"
              title="New Repair Order"
            >
              <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
            </button>
          }
        />
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 px-1">Repairs sorted by most urgent</p>

        <TabSwitch
          tabs={[
            { id: 'active', label: 'Active', color: 'blue' },
            { id: 'done', label: 'Done', color: 'emerald' },
          ]}
          activeTab={activeTab}
          onTabChange={(tab) =>
            updateParams((params) => {
              if (tab === 'done') {
                params.set('tab', 'done');
              } else {
                params.delete('tab');
              }
            })
          }
        />
      </motion.div>

      <motion.div variants={itemVariants} className="mt-auto pt-6 border-t border-gray-100 text-center">
        <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">Repair Module v2.1</p>
      </motion.div>
    </motion.div>
  );

  if (embedded) {
    return <div className="h-full overflow-hidden bg-white">{content}</div>;
  }

  return <aside className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-200 relative">{content}</aside>;
}
