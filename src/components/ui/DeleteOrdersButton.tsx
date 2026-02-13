'use client';

import { useEffect, useRef, useState } from 'react';

interface DeleteOrdersButtonProps {
  orderId?: number;
  orderIds?: number[];
  label?: string;
  className?: string;
  confirmMessage?: string;
  disabled?: boolean;
  onDeleted?: () => void;
}

export default function DeleteOrdersButton({
  orderId,
  orderIds,
  label = 'Delete',
  className = '',
  confirmMessage: _confirmMessage = 'Delete order(s)? This cannot be undone.',
  disabled = false,
  onDeleted,
}: DeleteOrdersButtonProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const armTimeoutRef = useRef<number | null>(null);
  const ids = orderId ? [orderId] : (orderIds || []);
  const isDisabled = disabled || ids.length === 0 || isDeleting;

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
      const res = await fetch('/api/orders/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: ids }),
      });

      if (res.ok) {
        onDeleted?.();
      }
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
      {isDeleting ? 'Deleting...' : isDeleteArmed ? 'Click again to confirm' : label}
    </button>
  );
}
