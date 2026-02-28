'use client';

import { ReactNode } from 'react';
import { ShippedFormData } from '@/components/shipped';
import { ShippedIntakeForm } from '@/components/shipped/ShippedIntakeForm';
import { Package, RotateCcw } from '@/components/Icons';
import { motion } from 'framer-motion';

interface UnshippedSidebarProps {
  showIntakeForm?: boolean;
  onCloseForm?: () => void;
  onFormSubmit?: (data: ShippedFormData) => void;
  filterControl?: ReactNode;
  embedded?: boolean;
  hideSectionHeader?: boolean;
}

export default function UnshippedSidebar(props: UnshippedSidebarProps) {
  const {
    showIntakeForm = false,
    onCloseForm,
    onFormSubmit,
    filterControl,
    embedded = false,
    hideSectionHeader = false,
  } = props;

  if (showIntakeForm) {
    return (
      <ShippedIntakeForm
        onClose={onCloseForm || (() => {})}
        onSubmit={onFormSubmit || (() => {})}
      />
    );
  }

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

  const content = (
    <>
      {filterControl ? (
        <motion.div initial="hidden" animate="visible" variants={containerVariants} className="relative z-20">
          {filterControl}
        </motion.div>
      ) : null}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className={`h-full flex flex-col overflow-y-auto no-scrollbar px-6 pb-6 ${filterControl ? 'pt-4' : 'pt-6'}`}
      >
        {!hideSectionHeader ? (
          <motion.header variants={itemVariants}>
            <h2 className="text-xl font-black tracking-tighter uppercase leading-none text-gray-900">
              Unshipped
            </h2>
            <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mt-1">
              Shipping Queue
            </p>
          </motion.header>
        ) : null}

        <motion.section variants={itemVariants} className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-wider text-blue-900">
                Mock ShipStation Import
              </p>
              <p className="text-[10px] font-bold text-blue-700 mt-1">
                Import source: ShipStation staging feed
              </p>
              <p className="text-[10px] font-medium text-blue-800/90 mt-2 leading-relaxed">
                Showing orders missing tracking numbers. Use this mock panel to validate unshipped flow and shipping readiness.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="mt-3 w-full h-9 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-wider"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Run Mock Import
          </button>
        </motion.section>

        <motion.section variants={itemVariants} className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-wider text-gray-700">Shipping Mock Details</p>
          <div className="flex items-center justify-between text-[10px] font-bold text-gray-600">
            <span>Carrier Mix</span>
            <span>USPS / UPS / FedEx</span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-bold text-gray-600">
            <span>Label Status</span>
            <span>Awaiting Generation</span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-bold text-gray-600">
            <span>Cutoff Window</span>
            <span>4:00 PM PST</span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-bold text-gray-600">
            <span>Batch Grouping</span>
            <span>By Ship-By Date</span>
          </div>
        </motion.section>
      </motion.div>
    </>
  );

  if (embedded) {
    return <div className="h-full overflow-hidden bg-white">{content}</div>;
  }

  return (
    <aside className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-200 relative w-[300px]">
      {content}
    </aside>
  );
}
