export function qtyTag(value: number, kind: 'planned' | 'printed' | 'remaining') {
  const cfg: Record<typeof kind, string> = {
    planned: 'border-sky-200 bg-sky-50 text-sky-800',
    printed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    remaining: 'border-amber-200 bg-amber-50 text-amber-700',
  };
  return (
    <span
      className={`inline-flex min-w-[28px] items-center justify-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${cfg[kind]}`}
    >
      {value}
    </span>
  );
}
