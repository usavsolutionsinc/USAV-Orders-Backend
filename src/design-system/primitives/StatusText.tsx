'use client';

interface StatusTextProps {
  label: string;
  colorVar: string;
  className?: string;
}

export function StatusText({ label, colorVar, className = '' }: StatusTextProps) {
  return (
    <span
      className={`inline-flex items-center border-b-2 border-current pb-0.5 text-[9px] font-black uppercase tracking-[0.08em] leading-none ${className}`.trim()}
      style={{
        color: `var(${colorVar})`,
        borderBottomColor: `color-mix(in srgb, var(${colorVar}) 82%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}
