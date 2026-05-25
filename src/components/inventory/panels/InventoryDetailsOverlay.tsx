'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
    INVENTORY_DETAILS_EVENTS,
    getOpenInventoryDetailsPayload,
    parseInventoryOpenKey,
    type InventoryDetailKind,
} from '@/lib/inventory-events-channel';
import { AlertDetailsPanel } from './AlertDetailsPanel';
import { BinDetailsPanel } from './BinDetailsPanel';
import { CountCampaignDetailsPanel } from './CountCampaignDetailsPanel';
import { SkuDetailsPanel } from './SkuDetailsPanel';
import { UnitDetailsPanel } from './UnitDetailsPanel';

interface OverlaySelection {
    kind: InventoryDetailKind;
    ref: string;
}

const SUPPORTED_KINDS: InventoryDetailKind[] = ['bin', 'sku', 'unit', 'alert', 'count'];

/**
 * Controller for the inventory detail view.
 *
 * Returns the active panel as inline content (no portal, no fixed
 * positioning) so it fills the main pane to the right of the sidebar.
 * Returns `null` when nothing is selected — the parent then renders the
 * default view (e.g. `PulseView`).
 *
 * Selection is URL-driven (`?open=<kind>:<ref>`); the events channel is a
 * convenience for in-session clicks/navigate.
 */
export function InventoryDetailsOverlay() {
    const searchParams = useSearchParams();
    const openParam = searchParams.get('open');

    const [selection, setSelection] = useState<OverlaySelection | null>(() => {
        const payload = parseInventoryOpenKey(openParam);
        if (!payload || !SUPPORTED_KINDS.includes(payload.kind)) return null;
        return { kind: payload.kind, ref: payload.ref };
    });

    useEffect(() => {
        const payload = parseInventoryOpenKey(openParam);
        if (!payload || !SUPPORTED_KINDS.includes(payload.kind)) {
            setSelection(null);
            return;
        }
        setSelection((prev) =>
            prev && prev.kind === payload.kind && prev.ref === payload.ref
                ? prev
                : { kind: payload.kind, ref: payload.ref },
        );
    }, [openParam]);

    useEffect(() => {
        const handleOpen = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const payload = getOpenInventoryDetailsPayload(detail);
            if (!payload) return;
            if (!SUPPORTED_KINDS.includes(payload.kind)) return;
            setSelection({ kind: payload.kind, ref: payload.ref });
        };
        const handleClose = () => setSelection(null);
        window.addEventListener(INVENTORY_DETAILS_EVENTS.OPEN, handleOpen);
        window.addEventListener(INVENTORY_DETAILS_EVENTS.CLOSE, handleClose);
        return () => {
            window.removeEventListener(INVENTORY_DETAILS_EVENTS.OPEN, handleOpen);
            window.removeEventListener(INVENTORY_DETAILS_EVENTS.CLOSE, handleClose);
        };
    }, []);

    if (!selection) return null;

    if (selection.kind === 'bin') {
        return (
            <BinDetailsPanel
                key={`bin:${selection.ref}`}
                barcode={selection.ref}
                onClose={() => setSelection(null)}
            />
        );
    }
    if (selection.kind === 'sku') {
        return (
            <SkuDetailsPanel
                key={`sku:${selection.ref}`}
                sku={selection.ref}
                onClose={() => setSelection(null)}
            />
        );
    }
    if (selection.kind === 'unit') {
        return (
            <UnitDetailsPanel
                key={`unit:${selection.ref}`}
                ref={selection.ref}
                onClose={() => setSelection(null)}
            />
        );
    }
    if (selection.kind === 'alert') {
        return (
            <AlertDetailsPanel
                key={`alert:${selection.ref}`}
                alertId={selection.ref}
                onClose={() => setSelection(null)}
            />
        );
    }
    if (selection.kind === 'count') {
        return (
            <CountCampaignDetailsPanel
                key={`count:${selection.ref}`}
                campaignId={selection.ref}
                onClose={() => setSelection(null)}
            />
        );
    }
    return null;
}
