'use client';

import { useState, useCallback } from 'react';
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import type { PanelAllocations, BucketAllocation } from '@/lib/fba/types';

export interface SplitState {
  itemId: number;
  fnsku: string;
  sourceContainer: string;
  destContainer: string;
  maxQty: number;
}

interface UseFbaDragAndDropOptions {
  allocations: PanelAllocations;
  setAllocations: React.Dispatch<React.SetStateAction<PanelAllocations>>;
  getItemFnsku: (itemId: number) => string;
}

function findAllocationInContainer(
  allocations: PanelAllocations,
  containerId: string,
  itemId: number,
): BucketAllocation | undefined {
  if (containerId === 'unallocated') {
    return allocations.unallocated.find((a) => a.item_id === itemId);
  }
  const bucketId = containerId.replace('bucket-', '');
  const bucket = allocations.buckets.find((b) => b.bucketId === bucketId);
  return bucket?.allocations.find((a) => a.item_id === itemId);
}

function moveItem(
  allocations: PanelAllocations,
  sourceContainer: string,
  destContainer: string,
  itemId: number,
  moveQty: number,
): PanelAllocations {
  const next = {
    unallocated: [...allocations.unallocated],
    buckets: allocations.buckets.map((b) => ({ ...b, allocations: [...b.allocations] })),
  };

  // Remove or reduce qty from source
  const removeFrom = (list: BucketAllocation[]) => {
    const idx = list.findIndex((a) => a.item_id === itemId);
    if (idx === -1) return;
    const current = list[idx];
    if (moveQty >= current.qty) {
      list.splice(idx, 1);
    } else {
      list[idx] = { ...current, qty: current.qty - moveQty };
    }
  };

  // Add or increase qty in destination
  const addTo = (list: BucketAllocation[]) => {
    const existing = list.find((a) => a.item_id === itemId);
    if (existing) {
      const idx = list.indexOf(existing);
      list[idx] = { ...existing, qty: existing.qty + moveQty };
    } else {
      list.push({ item_id: itemId, qty: moveQty });
    }
  };

  if (sourceContainer === 'unallocated') {
    removeFrom(next.unallocated);
  } else {
    const srcBucketId = sourceContainer.replace('bucket-', '');
    const srcBucket = next.buckets.find((b) => b.bucketId === srcBucketId);
    if (srcBucket) removeFrom(srcBucket.allocations);
  }

  if (destContainer === 'unallocated') {
    addTo(next.unallocated);
  } else {
    const destBucketId = destContainer.replace('bucket-', '');
    const destBucket = next.buckets.find((b) => b.bucketId === destBucketId);
    if (destBucket) addTo(destBucket.allocations);
  }

  return next;
}

export function useFbaDragAndDrop({
  allocations,
  setAllocations,
  getItemFnsku,
}: UseFbaDragAndDropOptions) {
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [splitState, setSplitState] = useState<SplitState | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { itemId: number } | undefined;
    setActiveItemId(data?.itemId ?? null);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveItemId(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as { itemId: number; sourceContainer: string } | undefined;
    if (!activeData) return;

    const destContainer = String(over.id);
    const sourceContainer = activeData.sourceContainer;
    if (sourceContainer === destContainer) return;

    const alloc = findAllocationInContainer(allocations, sourceContainer, activeData.itemId);
    if (!alloc) return;

    if (alloc.qty <= 1) {
      // Move entire item immediately
      setAllocations((prev) => moveItem(prev, sourceContainer, destContainer, activeData.itemId, alloc.qty));
    } else {
      // Show split popover
      setSplitState({
        itemId: activeData.itemId,
        fnsku: getItemFnsku(activeData.itemId),
        sourceContainer,
        destContainer,
        maxQty: alloc.qty,
      });
    }
  }, [allocations, setAllocations, getItemFnsku]);

  const handleDragCancel = useCallback(() => {
    setActiveItemId(null);
  }, []);

  const confirmSplit = useCallback((moveQty: number) => {
    if (!splitState) return;
    setAllocations((prev) =>
      moveItem(prev, splitState.sourceContainer, splitState.destContainer, splitState.itemId, moveQty),
    );
    setSplitState(null);
  }, [splitState, setAllocations]);

  const cancelSplit = useCallback(() => {
    setSplitState(null);
  }, []);

  return {
    activeItemId,
    sensors,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    splitState,
    confirmSplit,
    cancelSplit,
  };
}
