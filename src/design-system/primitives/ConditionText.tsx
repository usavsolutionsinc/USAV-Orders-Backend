'use client';

export interface ConditionTextProps {
  condition: string | null | undefined;
  quantity?: number;
  productTitle?: string;
  className?: string;
}

/**
 * Returns the Tailwind text color class for an item condition.
 * - "new" → yellow-500
 * - "parts" → amber-800
 * - default (used) → black
 */
export function getConditionColor(condition: string | null | undefined): string {
  const c = (condition || '').toLowerCase().trim();
  if (c.includes('new')) return 'text-yellow-500';
  if (c.includes('part')) return 'text-amber-800';
  return 'text-black';
}

/**
 * Formats a raw condition string for display.
 * Strips underscores, handles empty / "FBA SCAN" → "N/A".
 */
export function formatConditionLabel(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  const normalized = raw.toUpperCase().replace(/\s+/g, ' ');
  if (!raw || normalized === 'FBA SCAN') return 'N/A';
  return raw.replaceAll('_', ' ');
}

/**
 * Inline condition + qty + title display.
 * Renders: `{qty >= 2 ? "x{qty} " : ""}{condition} {title}`
 * with condition-based colors and yellow qty highlight.
 *
 * Uses: semantic.condition tokens (text-yellow-500, text-amber-800, text-black)
 */
export function ConditionText({
  condition,
  quantity = 1,
  productTitle = '',
  className = '',
}: ConditionTextProps) {
  const conditionLabel = formatConditionLabel(condition);
  const conditionColor = getConditionColor(condition);

  return (
    <h4 className={`text-base font-black text-gray-900 leading-tight ${className}`.trim()}>
      {quantity >= 2 && <span className="text-yellow-500">x{quantity} </span>}
      <span className={conditionColor}>{conditionLabel}</span>
      {productTitle && ` ${productTitle}`}
    </h4>
  );
}
