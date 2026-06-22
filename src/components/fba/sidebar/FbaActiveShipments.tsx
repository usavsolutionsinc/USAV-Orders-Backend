'use client';

/**
 * FBA active-shipments rail — thin composition shell. The fetch + bundle
 * transform, editor-mode event wiring, and refresh subscription live in
 * {@link useFbaActiveShipments}; the shipment card + tracking group are
 * presentational components under `./active-shipments/`.
 */

import { LayoutGroup } from 'framer-motion';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { FbaShipmentEditorForm } from '@/components/fba/sidebar/FbaShipmentEditorForm';
import { sectionLabel, SkeletonList } from '@/design-system';
import type { StationTheme } from '@/utils/staff-colors';
import { useFbaActiveShipments } from './active-shipments/useFbaActiveShipments';
import { ActiveShipmentCard } from './active-shipments/ActiveShipmentCard';

export function FbaActiveShipments({ stationTheme = 'green' }: { stationTheme?: StationTheme }) {
  const {
    shipments, recentShipped, loading,
    expandedIds, toggleExpand,
    editingShipment, setEditingShipment,
    emitChanged,
  } = useFbaActiveShipments();

  if (loading) {
    return (
      <div className={`space-y-3 ${SIDEBAR_GUTTER} py-4`}>
        <div className="h-4 w-32 bg-zinc-100 rounded animate-pulse mb-3" />
        <SkeletonList count={3} type="card" />
      </div>
    );
  }

  if (shipments.length === 0 && recentShipped.length === 0 && !editingShipment) return null;

  // ── Editor form (replaces the card list while active) ──
  if (editingShipment) {
    return (
      <FbaShipmentEditorForm
        shipment={editingShipment}
        stationTheme={stationTheme}
        onClose={() => setEditingShipment(null)}
        onChanged={() => {
          setEditingShipment(null);
          emitChanged();
        }}
      />
    );
  }

  return (
    <div className="pb-4">
      <LayoutGroup id="fba-active-shipments">
        {shipments.map((shipment) => (
          <ActiveShipmentCard
            key={shipment.id}
            shipment={shipment}
            stationTheme={stationTheme}
            editable
            isExpanded={expandedIds.has(shipment.id)}
            onToggleExpand={() => toggleExpand(shipment.id)}
            onChanged={emitChanged}
          />
        ))}

        {recentShipped.length > 0 && (
          <div className="mt-6">
            <p className={`mb-3 px-4 ${sectionLabel} text-gray-500`}>Recent shipments</p>
            {recentShipped.map((shipment) => (
              <ActiveShipmentCard
                key={shipment.id}
                shipment={shipment}
                stationTheme={stationTheme}
                editable={false}
                isExpanded={expandedIds.has(shipment.id)}
                onToggleExpand={() => toggleExpand(shipment.id)}
                onChanged={emitChanged}
              />
            ))}
          </div>
        )}
      </LayoutGroup>
    </div>
  );
}
