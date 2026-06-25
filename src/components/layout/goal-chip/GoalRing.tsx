import { motion } from 'framer-motion';

/** Animated SVG progress ring with the integer percent in its center. */
export function GoalRing({ percent, color, size = 26 }: { percent: number; color: string; size?: number }) {
  const r = size / 2 - 2.5;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg className="h-full w-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#E5E7EB" strokeWidth="2.5" fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - clamped / 100) }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="font-extrabold tabular-nums tracking-tight text-gray-900"
          style={{ fontSize: Math.max(7, size * 0.3) }}
        >
          {clamped}
        </span>
      </div>
    </div>
  );
}
