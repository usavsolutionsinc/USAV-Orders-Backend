'use client';

import { motion } from 'framer-motion';
import MultiSkuSnBarcode from './MultiSkuSnBarcode';

interface BarcodeSidebarProps {
    embedded?: boolean;
}

export default function BarcodeSidebar({ embedded = false }: BarcodeSidebarProps) {
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
        <motion.div initial="hidden" animate="visible" variants={containerVariants} className="h-full flex flex-col overflow-hidden">
            <motion.header variants={itemVariants} className="p-6 border-b border-gray-100 bg-gray-50">
                <h2 className="text-xl font-black tracking-tighter uppercase leading-none text-gray-900">
                    SKU Generator
                </h2>
                <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mt-1">
                    Label Production
                </p>
            </motion.header>
            <motion.div variants={itemVariants} className="flex-1 overflow-y-auto scrollbar-hide">
                <MultiSkuSnBarcode />
            </motion.div>
            <motion.footer variants={itemVariants} className="p-4 border-t border-gray-100 opacity-30 mt-auto text-center">
                <p className="text-[7px] font-mono uppercase tracking-[0.2em] text-gray-500">USAV GEN</p>
            </motion.footer>
        </motion.div>
    );

    if (embedded) {
        return <div className="h-full overflow-hidden bg-white">{content}</div>;
    }

    return (
        <div className="relative flex-shrink-0 z-40 h-full">
            <aside className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-200 relative group w-[400px]">
                {content}
            </aside>
        </div>
    );
}
