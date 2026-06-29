'use client';

import { useState, type ReactNode } from 'react';
import { Copy, ExternalLink } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { DetailsPanelRow } from '@/design-system/components/DetailsPanelRow';
import { getTrackingUrl, getTrackingUrlByCarrier } from '@/lib/tracking-format';

export interface TrackingNumberRowProps {
  value: string;
  /** Uppercase ledger label. Default "Tracking Number" (shipped panel wording). */
  label?: string;
  placeholder?: string;
  /** Inline-edit change handler. Only wired when `allowEdit` is on. */
  onChange?: (value: string) => void;
  /** Fired when the inline editor blurs (commit point). Only when `allowEdit`. */
  onBlur?: () => void;
  /** @deprecated The paste-&-replace clipboard icon was replaced by the carrier
   *  external-link icon. Accepted (so existing callers keep type-checking) but no
   *  longer rendered. */
  onPasteReplace?: () => Promise<void> | void;
  /**
   * Click-to-edit the value inline. The shipped panel leaves this off (edits go
   * through its modal); the receiving panel turns it on so tracking stays
   * hand-editable while still rendering identically when not being edited.
   */
  allowEdit?: boolean;
  headerAccessory?: ReactNode;
  headerAccessoryClassName?: string;
  /** Keep the bottom divider even as the last child (rows above more content). */
  keepBottomDivider?: boolean;
  className?: string;
  dividerClassName?: string;
}

/**
 * Canonical tracking-number display row, extracted from the shipped details
 * panel (the reference design) so the receiving details panel renders tracking
 * the exact same way — uppercase label, bold value, an external-link to the
 * carrier's tracking page (for the in-depth carrier updates), and copy.
 */
export function TrackingNumberRow({
  value,
  label = 'Tracking Number',
  placeholder = 'No tracking number',
  onChange,
  onBlur,
  allowEdit = false,
  headerAccessory,
  headerAccessoryClassName,
  keepBottomDivider = false,
  className,
  dividerClassName,
}: TrackingNumberRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const displayValue = String(value || '').trim();
  const iconClassName = 'h-3.5 w-3.5';
  // Carrier tracking page for the live in-depth updates. getTrackingUrl resolves
  // known carriers by number pattern; fall back to the carrier-agnostic builder
  // (a tracking-number web search) so the link always opens something useful.
  const trackingUrl = displayValue
    ? (getTrackingUrl(displayValue) ?? getTrackingUrlByCarrier(displayValue, ''))
    : null;

  const actions = (
    <div className="flex items-center gap-1.5 text-gray-400">
      {trackingUrl ? (
        <HoverTooltip label={`Open ${label} on the carrier site for full tracking updates`} asChild>
          <a
            href={trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="transition-colors hover:text-blue-600"
            aria-label={`Track ${label} on the carrier site`}
          >
            <ExternalLink className={iconClassName} />
          </a>
        </HoverTooltip>
      ) : null}
      <HoverTooltip label={`Copy ${label}`} asChild>
        <IconButton
          ariaLabel={`Copy ${label}`}
          onClick={() => {
            if (!displayValue) return;
            navigator.clipboard.writeText(displayValue);
          }}
          icon={<Copy className={iconClassName} />}
        />
      </HoverTooltip>
    </div>
  );

  const rowClassName = keepBottomDivider
    ? (className ?? '')
    : className
      ? `${className} last:border-b-0`
      : 'last:border-b-0';

  return (
    <DetailsPanelRow
      label={label}
      headerAccessory={headerAccessory ? (
        <span className={headerAccessoryClassName || 'text-micro font-black uppercase tracking-wide text-gray-500'}>
          {headerAccessory}
        </span>
      ) : null}
      actions={actions}
      className={rowClassName}
      dividerClassName={dividerClassName}
    >
      {allowEdit && isEditing ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={() => {
            setIsEditing(false);
            onBlur?.();
          }}
          placeholder={placeholder}
          autoFocus
          className="h-8 w-full border-0 bg-transparent px-0 text-sm font-bold text-gray-900 outline-none ring-0"
        />
      ) : allowEdit ? (
        <button type="button" onClick={() => setIsEditing(true)} className="ds-raw-button block w-full py-0 text-left">
          <p className="truncate text-sm font-bold text-gray-900">{displayValue || placeholder}</p>
        </button>
      ) : (
        <p className="truncate text-sm font-bold text-gray-900">{displayValue || placeholder}</p>
      )}
    </DetailsPanelRow>
  );
}
