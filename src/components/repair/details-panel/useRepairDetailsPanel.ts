'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RSRecord } from '@/lib/neon/repair-service-queries';
import { usePanelActions } from '@/hooks/usePanelActions';
import { zendeskTicketUrl as buildZendeskTicketUrl } from '@/lib/zendesk-ticket-url';
import { useActivityInboxOptional } from '@/contexts/ActivityInboxContext';
import type { RepairTabId } from './repair-details-shared';

/**
 * Owns the repair details panel's interactive concerns: ticket-number /
 * notes / status edits, the manual linkage editors (order / tracking / serial /
 * SKU) with set + clear, soft-cancel delete, the customer-pickup-flow toggle,
 * and the derived pickup eligibility + linkage dirty/has-any state + audit panel
 * actions. Returns a controller bag the thin shell + sections render from.
 */
export function useRepairDetailsPanel({ repair, onUpdate }: { repair: RSRecord; onUpdate: () => void }) {
  const inbox = useActivityInboxOptional();
  const [notes, setNotes] = useState(repair.notes || '');
  const [ticketNumber, setTicketNumber] = useState(repair.ticket_number || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingTicket, setIsSavingTicket] = useState(false);
  const [isEditingTicket, setIsEditingTicket] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showPickupFlow, setShowPickupFlow] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<RepairTabId>('overview');
  const ticketInputRef = useRef<HTMLInputElement>(null);

  // Manual pairing — link a ticket to an order / inbound tracking / serial /
  // catalog SKU. Saved via POST .../link (set) or DELETE .../link?fields= (clear).
  const [linkOrderId, setLinkOrderId] = useState(repair.source_order_id || '');
  const [linkTracking, setLinkTracking] = useState(repair.source_tracking_number || '');
  const [linkSerial, setLinkSerial] = useState(repair.serial_number || '');
  const [linkSku, setLinkSku] = useState(repair.source_sku || '');
  const [savingLink, setSavingLink] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Delete = soft-cancel (status → 'Cancelled'); the row stays for audit but
  // drops out of every queue tab. Repairs link to documents/history, so a hard
  // delete is intentionally not offered. Throws on failure so the shared
  // DeleteButton skips its onDeleted (close).
  const handleDelete = async () => {
    const res = await fetch(`/api/repair-service/${repair.id}`, { method: 'DELETE' });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      throw new Error(body?.error || `Delete failed (${res.status})`);
    }
    onUpdate();
  };

  const PICKUP_STATUSES = useMemo(
    () => new Set(['Repaired, Contact Customer', 'Awaiting Pickup', 'Awaiting Payment', 'Done']),
    [],
  );
  const canStartPickup = PICKUP_STATUSES.has((repair.status || '').trim());

  useEffect(() => {
    setNotes(repair.notes || '');
    setTicketNumber(repair.ticket_number || '');
    setIsEditingTicket(false);
    setIsEditingNotes(false);
    setIsSavingTicket(false);
    setActiveTab('overview');
  }, [repair.id, repair.notes, repair.ticket_number]);

  // Re-sync the linkage editors whenever a different ticket (or fresh server
  // values after a save) flows in.
  useEffect(() => {
    setLinkOrderId(repair.source_order_id || '');
    setLinkTracking(repair.source_tracking_number || '');
    setLinkSerial(repair.serial_number || '');
    setLinkSku(repair.source_sku || '');
  }, [repair.id, repair.source_order_id, repair.source_tracking_number, repair.serial_number, repair.source_sku]);

  const handleSaveLinks = async () => {
    setSavingLink(true);
    try {
      const res = await fetch(`/api/repair-service/${repair.id}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_order_id: linkOrderId.trim() || null,
          source_tracking_number: linkTracking.trim() || null,
          serial_number: linkSerial.trim() || null,
          source_sku: linkSku.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('link failed');
      onUpdate();
    } catch (error) {
      console.error('Error saving repair links:', error);
    } finally {
      setSavingLink(false);
    }
  };

  const handleClearLinks = async () => {
    setSavingLink(true);
    try {
      const res = await fetch(`/api/repair-service/${repair.id}/link`, { method: 'DELETE' });
      if (!res.ok) throw new Error('unlink failed');
      setLinkOrderId('');
      setLinkTracking('');
      setLinkSerial('');
      setLinkSku('');
      onUpdate();
    } catch (error) {
      console.error('Error clearing repair links:', error);
    } finally {
      setSavingLink(false);
    }
  };

  const linksDirty =
    linkOrderId.trim() !== (repair.source_order_id || '') ||
    linkTracking.trim() !== (repair.source_tracking_number || '') ||
    linkSerial.trim() !== (repair.serial_number || '') ||
    linkSku.trim() !== (repair.source_sku || '');

  const hasAnyLink = Boolean(
    (repair.source_order_id || '').trim() ||
      (repair.source_tracking_number || '').trim() ||
      (repair.serial_number || '').trim() ||
      (repair.source_sku || '').trim(),
  );

  useEffect(() => {
    if (isEditingTicket && ticketInputRef.current) {
      ticketInputRef.current.focus();
      ticketInputRef.current.select();
    }
  }, [isEditingTicket]);

  const handleSaveTicket = async () => {
    if (ticketNumber === repair.ticket_number) {
      setIsEditingTicket(false);
      return;
    }

    setIsSavingTicket(true);
    try {
      const res = await fetch('/api/repair-service', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: repair.id,
          field: 'ticket_number',
          value: ticketNumber,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to save ticket number');
      }

      onUpdate();
    } catch (error) {
      console.error('Error saving ticket number:', error);
      setTicketNumber(repair.ticket_number || '');
    } finally {
      setIsSavingTicket(false);
      setIsEditingTicket(false);
    }
  };

  const panelActions = usePanelActions(
    { entityType: 'repair', entityId: repair.id },
    {
      notes: () => setIsEditingNotes(true),
    },
  );

  // Shared helper already returns null for the `RS-<id>` fallback (non-numeric)
  // and passes through full URLs an operator may have pasted.
  const zendeskTicketUrl = buildZendeskTicketUrl(ticketNumber);

  const handleSaveNotes = async () => {
    if (notes === repair.notes) {
      setIsEditingNotes(false);
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/repair-service', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: repair.id, notes }),
      });

      if (!res.ok) {
        throw new Error('Failed to save notes');
      }

      onUpdate();
      setIsEditingNotes(false);
    } catch (error) {
      console.error('Error saving notes:', error);
      setNotes(repair.notes || '');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    const previousStatus = typeof repair.status === 'string' ? repair.status : '';
    if (previousStatus === newStatus) return;

    setUpdatingStatus(true);
    try {
      const res = await fetch('/api/repair-service', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: repair.id, status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      inbox?.pushRepairStatusChange({
        repairId: repair.id,
        previousStatus,
        nextStatus: newStatus,
      });
      onUpdate();
    } catch (error) {
      console.error('Error updating status:', error);
    } finally {
      setUpdatingStatus(false);
    }
  };

  return {
    notes, setNotes,
    isEditingNotes, setIsEditingNotes,
    ticketNumber, setTicketNumber,
    isSaving, isSavingTicket, isEditingTicket, setIsEditingTicket,
    updatingStatus,
    showPickupFlow, setShowPickupFlow,
    isMounted,
    activeTab, setActiveTab,
    ticketInputRef,
    linkOrderId, setLinkOrderId,
    linkTracking, setLinkTracking,
    linkSerial, setLinkSerial,
    linkSku, setLinkSku,
    savingLink,
    canStartPickup,
    linksDirty, hasAnyLink,
    panelActions,
    zendeskTicketUrl,
    handleDelete, handleSaveLinks, handleClearLinks,
    handleSaveTicket, handleSaveNotes, handleStatusChange,
  };
}

export type RepairDetailsController = ReturnType<typeof useRepairDetailsPanel>;
