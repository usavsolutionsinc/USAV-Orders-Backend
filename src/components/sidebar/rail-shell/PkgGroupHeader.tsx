import { motion } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { ChevronDown } from '@/components/Icons';
import { staggerRevealItem } from '@/design-system/primitives/StaggerReveal';

export function PkgGroupHeader({ groupSize, isCollapsed, staggerReveal, onToggle }: { groupSize: number; isCollapsed: boolean; staggerReveal: boolean; onToggle: () => void }) {
  const motionProps = staggerReveal
    ? { variants: staggerRevealItem }
    : { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12, ease: motionBezier.easeOut } };
  return (
    <motion.li
      role="presentation"
      {...motionProps}
      className="relative"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? 'Expand package' : 'Collapse package'}
        className="ds-raw-button flex w-full items-center gap-1.5 rounded-t-md border-t border-x border-indigo-200/70 bg-indigo-50/80 pl-3 pr-2 py-1 text-left text-indigo-700 transition-colors hover:bg-indigo-100/80"
      >
        <motion.span animate={{ rotate: isCollapsed ? -90 : 0 }} transition={{ duration: 0.18, ease: motionBezier.easeOut }} className="inline-flex">
          <ChevronDown className="h-3 w-3" />
        </motion.span>
        <span className="text-[8.5px] font-black uppercase tracking-widest">PKG · {groupSize}</span>
        <span className="ml-auto text-[8.5px] font-bold uppercase tracking-widest text-indigo-400">{groupSize} items</span>
      </button>
    </motion.li>
  );
}
