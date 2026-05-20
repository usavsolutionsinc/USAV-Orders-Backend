'use client';

/**
 * MobileSettingsButton — small gear that opens FeedbackSettingsSheet.
 *
 * Self-contained: holds the sheet's open state internally so callers just
 * drop `<MobileSettingsButton />` next to `<NetworkChip />` in any mobile
 * toolbar `trailing` slot. No props required.
 *
 * Keep this for *quick* settings only (haptic / sound). Workflow-level
 * settings belong in /settings.
 */

import { useState } from 'react';
import { Settings } from 'lucide-react';
import { FeedbackSettingsSheet } from '@/components/mobile/FeedbackSettingsSheet';

interface MobileSettingsButtonProps {
  /** Aria-label override. Default "Feedback settings". */
  label?: string;
  className?: string;
}

export function MobileSettingsButton({ label = 'Feedback settings', className = '' }: MobileSettingsButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        className={`grid h-8 w-8 place-items-center rounded-full text-slate-500 transition-colors active:bg-slate-100 active:text-slate-700 ${className}`}
      >
        <Settings className="h-4 w-4" aria-hidden="true" />
      </button>
      <FeedbackSettingsSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
