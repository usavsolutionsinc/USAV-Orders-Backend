import type { ReactNode } from 'react';
import {
  AlertTriangle,
  FileText,
  Flag,
  PackageCheck,
} from '@/components/Icons';

/* ── Types ─────────────────────────────────────────────────────────── */

export type PanelEntityType = 'order' | 'work_order' | 'fba_item' | 'repair';

export interface PanelAction {
  key: string;
  label: string;
  icon: ReactNode;
  toneClassName: string;
  onAction: () => void;
}

export interface PanelActionContext {
  entityType: PanelEntityType;
  entityId: number | string;
  orderId?: string | null;
}

/* ── Catalog ───────────────────────────────────────────────────────── */

const ACTION_CATALOG: Record<string, { label: string; icon: ReactNode; toneClassName: string }> = {
  goals:        { label: 'Goals',        icon: <Flag className="h-3.5 w-3.5" />,           toneClassName: 'text-blue-600' },
  status:       { label: 'Status',       icon: <PackageCheck className="h-3.5 w-3.5" />,   toneClassName: 'text-emerald-600' },
  out_of_stock: { label: 'Out of stock', icon: <AlertTriangle className="h-3.5 w-3.5" />,  toneClassName: 'text-orange-600' },
  notes:        { label: 'Notes',        icon: <FileText className="h-3.5 w-3.5" />,       toneClassName: 'text-gray-600' },
};

const ENTITY_ACTION_KEYS: Record<PanelEntityType, string[]> = {
  order:      ['goals', 'status', 'out_of_stock', 'notes'],
  work_order: ['goals', 'status', 'out_of_stock', 'notes'],
  fba_item:   ['goals', 'notes'],
  repair:     ['notes'],
};

/* ── Hook ──────────────────────────────────────────────────────────── */

export function usePanelActions(
  context: PanelActionContext,
  handlers: Partial<Record<string, () => void>> = {},
): PanelAction[] {
  const keys = ENTITY_ACTION_KEYS[context.entityType] ?? [];

  return keys
    .map((key) => {
      const catalog = ACTION_CATALOG[key];
      if (!catalog) return null;

      // Goals is universal — auto-handled when orderId exists
      if (key === 'goals') {
        if (!context.orderId) return null;
        const orderId = context.orderId;
        return {
          key,
          ...catalog,
          onAction: () => { window.location.href = `/admin?orderId=${encodeURIComponent(orderId)}`; },
        };
      }

      // All other actions require an explicit handler from the consumer
      const handler = handlers[key];
      if (!handler) return null;

      return { key, ...catalog, onAction: handler };
    })
    .filter((a): a is PanelAction => a !== null);
}
