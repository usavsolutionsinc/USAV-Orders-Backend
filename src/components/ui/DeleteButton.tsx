'use client';

import { useEffect, useRef, useState } from 'react';
import { useDeleteOrderRow } from '@/hooks';

interface DeleteButtonProps {
  orderId?: number;
  orderIds?: number[];
  /**
   * Custom delete action. When provided, it runs instead of the built-in
   * order-row mutation — letting any entity (PO, repair, bin, …) reuse the
   * two-step armed-confirm UX. Throw to abort (skips `onDeleted`); the caller
   * is responsible for surfacing its own error (e.g. a toast).
   */
  onConfirm?: () => Promise<void> | void;
  label?: string;
  /** Label shown while armed (defaults to "Click again to confirm"). */
  armedLabel?: string;
  className?: string;
  confirmMessage?: string;
  disabled?: boolean;
  onDeleted?: () => void;
}

export default function DeleteButton({
  orderId,
  orderIds,
  onConfirm,
  label = 'Delete',
  armedLabel = 'Click again to confirm',
  className = '',
  confirmMessage: _confirmMessage = 'Delete order(s)? This cannot be undone.',
  disabled = false,
  onDeleted,
}: DeleteButtonProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const armTimeoutRef = useRef<number | null>(null);
  const deleteOrderMutation = useDeleteOrderRow();
  const ids = orderId ? [orderId] : (orderIds || []);
  // With a custom `onConfirm` the order-id requirement doesn't apply.
  const hasTarget = onConfirm ? true : ids.length > 0;
  const isDisabled = disabled || !hasTarget || isDeleting || deleteOrderMutation.isPending;

  useEffect(() => {
    return () => {
      if (armTimeoutRef.current) {
        window.clearTimeout(armTimeoutRef.current);
      }
    };
  }, []);

  const handleDelete = async () => {
    if (isDisabled) return;
    if (!isDeleteArmed) {
      setIsDeleteArmed(true);
      if (armTimeoutRef.current) {
        window.clearTimeout(armTimeoutRef.current);
      }
      armTimeoutRef.current = window.setTimeout(() => {
        setIsDeleteArmed(false);
      }, 3000);
      return;
    }

    if (armTimeoutRef.current) {
      window.clearTimeout(armTimeoutRef.current);
      armTimeoutRef.current = null;
    }
    setIsDeleteArmed(false);

    setIsDeleting(true);
    try {
      if (onConfirm) {
        await onConfirm();
      } else {
        await deleteOrderMutation.mutateAsync({ rowSource: 'order', orderIds: ids });
      }
      onDeleted?.();
    } catch {
      // `onConfirm` surfaces its own error; just don't fire `onDeleted`.
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={isDisabled}
      className={className}
    >
      {isDeleting ? 'Deleting...' : isDeleteArmed ? armedLabel : label}
    </button>
  );
}
