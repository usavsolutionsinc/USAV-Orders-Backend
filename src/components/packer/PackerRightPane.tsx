'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { framerPresence } from '@/design-system/foundations/motion-framer';
import { useMotionPresence } from '@/design-system/foundations/motion-framer-hooks';
import { PackerTable } from '@/components/PackerTable';
import { ActivePackerWorkspace } from '@/components/packer/ActivePackerWorkspace';
import type { PackActiveOrderPane } from '@/components/packer/usePackerOrderPane';

interface PackerRightPaneProps {
  packerId: string;
  activeOrderPane: PackActiveOrderPane | null;
  onCloseActiveOrder: () => void;
}

/**
 * Packer dashboard right pane — history table with active-order crossfade,
 * matching TechRightPane on /tech.
 */
export function PackerRightPane({
  packerId,
  activeOrderPane,
  onCloseActiveOrder,
}: PackerRightPaneProps) {
  const tabFade = useMotionPresence(framerPresence.tableRow);

  return (
    <AnimatePresence initial={false} mode="wait">
      {activeOrderPane ? (
        <ActivePackerWorkspace
          key={`packer-workspace-${activeOrderPane.orderRowId ?? activeOrderPane.tracking}`}
          activeOrder={activeOrderPane}
          onClose={onCloseActiveOrder}
        />
      ) : (
        <motion.div
          key="packer-history"
          initial={tabFade.initial}
          animate={tabFade.animate}
          exit={tabFade.exit}
          transition={{ duration: 0.16 }}
          className="h-full w-full"
        >
          <PackerTable packedBy={parseInt(packerId, 10)} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
