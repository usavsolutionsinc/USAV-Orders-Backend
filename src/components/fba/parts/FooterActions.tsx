import { PropsWithChildren } from 'react';
import { motion } from 'framer-motion';

interface FooterActionsProps extends PropsWithChildren {
  flush?: boolean;
  className?: string;
}

export function FooterActions({ children, flush, className }: FooterActionsProps) {
  return (
    <motion.div
      layout
      className={`footer-actions flex shrink-0 flex-col gap-2 border-t border-zinc-200 px-3 ${
        flush ? 'pb-2 pt-2' : 'pb-3 pt-2.5'
      } ${className ?? ''}`}
    >
      {children}
    </motion.div>
  );
}
