'use client';

import { motion } from 'framer-motion';

/**
 * USAV Mobile 2026 Design Tokens & Base Components
 * 
 * Philosophy: Simple Premium. High contrast, Liquid Glass surfaces, 
 * purposeful motion, and thumb-friendly ergonomics.
 */

export const TOKENS = {
  colors: {
    primary: 'blue-600',
    primaryDark: 'blue-800',
    primaryGradient: 'from-blue-600 to-blue-800',
    primarySoft: 'bg-blue-50 text-blue-600',
    background: 'bg-slate-50', // Clean slate-50 as base
    surface: 'bg-white/80 backdrop-blur-2xl',
    card: 'bg-white shadow-[0_8px_30px_rgb(59,130,246,0.06)] ring-1 ring-blue-100/50',
    glass: 'bg-blue-50/50 backdrop-blur-xl border border-blue-100/50 shadow-[0_8px_32px_0_rgba(37,99,235,0.08)]',
    text: {
      primary: 'text-blue-950', // Deepest blue for text
      secondary: 'text-blue-700/70',
      muted: 'text-blue-400',
      inverted: 'text-white',
    }
  },
  radius: {
    base: 'rounded-2xl', // 16px
    large: 'rounded-[28px]', // 28px
    full: 'rounded-full',
  },
  motion: {
    spring: {
      type: 'spring' as const,
      stiffness: 300,
      damping: 30,
    },
    hover: {
      scale: 0.98,
      transition: { duration: 0.1 }
    },
    tap: {
      scale: 0.95
    }
  }
};

/**
 * Canonical mobile gutter — the single horizontal inset shared by every mobile
 * feed/table row. The mobile analog of the desktop `SIDEBAR_GUTTER` (px-1.5):
 * one value, applied in exactly ONE place (MobileRowCard), so all tables align.
 *
 * Value is the tightest gutter we had (the Picks tab). Feeds must NOT add their
 * own outer `px-*` — the row card supplies the gutter, and doubling it up is the
 * inconsistency this token exists to prevent.
 *
 * `MOBILE_GUTTER` is the padding form (collapsed rows); `MOBILE_GUTTER_X` is the
 * margin form for the floating expanded card. Keep the two on the same step.
 */
export const MOBILE_GUTTER = 'px-1.5';
export const MOBILE_GUTTER_X = 'mx-1.5';

/**
 * Ambient Card - Elevated with blue-tinted shadows and refined borders
 */
export const MobileCard = ({ 
  children, 
  className = '', 
  onClick,
  variant = 'default' 
}: { 
  children: React.ReactNode, 
  className?: string, 
  onClick?: () => void,
  variant?: 'default' | 'glass' | 'flat'
}) => (
  <motion.div
    whileTap={onClick ? TOKENS.motion.tap : undefined}
    onClick={onClick}
    className={`
      ${variant === 'glass' ? TOKENS.colors.glass : variant === 'flat' ? 'bg-blue-50/30 border border-blue-100/40' : TOKENS.colors.card} 
      ${TOKENS.radius.base} p-4
      ${onClick ? 'cursor-pointer active:scale-[0.98] transition-all' : ''}
      ${className}
    `.trim()}
  >
    {children}
  </motion.div>
);

/**
 * Bento Grid Item
 */
export const BentoItem = ({ 
  children, 
  className = '', 
  title, 
  icon: Icon,
  variant = 'default'
}: { 
  children: React.ReactNode, 
  className?: string, 
  title?: string, 
  icon?: React.ComponentType<{ className?: string }>,
  variant?: 'default' | 'glass'
}) => (
  <div className={`flex flex-col gap-2 ${className}`}>
    {title && (
      <div className="flex items-center gap-2 px-1">
        {Icon && <Icon className="h-3.5 w-3.5 text-blue-400" />}
        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-400">{title}</span>
      </div>
    )}
    <MobileCard variant={variant} className="flex-1">
      {children}
    </MobileCard>
  </div>
);

/**
 * Page Header - Refined typography and blue theme
 */
export const MobilePageHeader = ({ title, subtitle, action }: { title: string, subtitle?: string, action?: React.ReactNode }) => (
  <header className="flex flex-col gap-1 py-4 px-1">
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-black tracking-tight text-blue-950 leading-tight">{title}</h1>
      {action && <div>{action}</div>}
    </div>
    {subtitle && <p className="text-sm font-medium text-blue-700/60 leading-relaxed">{subtitle}</p>}
  </header>
);

/**
 * Premium Section Header
 */
export const SectionHeader = ({ title, actionLabel, onAction }: { title: string, actionLabel?: string, onAction?: () => void }) => (
  <div className="flex items-center justify-between px-1 mb-3">
    <span className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-400">{title}</span>
    {actionLabel && (
      <button 
        onClick={onAction}
        className="text-[11px] font-bold text-blue-600 uppercase tracking-wider"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

/**
 * Glass Button - USAV Blue themed button
 */
export const GlassButton = ({ 
  children, 
  onClick, 
  className = '', 
  variant = 'primary',
  icon: Icon
}: { 
  children: React.ReactNode, 
  onClick?: () => void, 
  className?: string,
  variant?: 'primary' | 'secondary' | 'ghost' | 'blue',
  icon?: React.ComponentType<{ className?: string }>
}) => {
  const baseStyles = "h-14 px-6 rounded-2xl flex items-center justify-center gap-3 font-black uppercase tracking-wider text-sm transition-all active:scale-[0.97]";
  const variants = {
    primary: "bg-blue-600 text-white shadow-xl shadow-blue-600/20",
    blue: "bg-blue-950 text-white shadow-xl shadow-blue-950/20",
    secondary: "bg-white border border-blue-100 text-blue-600 shadow-sm",
    ghost: "bg-transparent text-blue-400"
  };

  return (
    <motion.button
      whileTap={TOKENS.motion.tap}
      onClick={onClick}
      className={`${baseStyles} ${variants[variant]} ${className}`}
    >
      {Icon && <Icon className="h-5 w-5" />}
      {children}
    </motion.button>
  );
};
