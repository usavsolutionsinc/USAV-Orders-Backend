'use client';

import { useState } from 'react';

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
  confirmMessage = 'Delete order(s)? This cannot be undone.',
  disabled = false,
  onDeleted,
}: DeleteOrdersButtonProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const ids = orderId ? [orderId] : (orderIds || []);
  const isDisabled = disabled || ids.length === 0 || isDeleting;

  const handleDelete = async () => {
    if (isDisabled) return;
    if (!confirm(confirmMessage)) return;

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
      {isDeleting ? 'Deleting...' : label}
    </button>
  );
}
