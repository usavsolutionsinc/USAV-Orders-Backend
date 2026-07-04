import { useState } from 'react';
import { Clipboard, Copy, ExternalLink } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { DetailsPanelRow } from '@/design-system/components/DetailsPanelRow';
import { IconButton } from '@/design-system/primitives';

export function ShippingEditableRow({
  label,
  value,
  placeholder,
  onChange,
  onBlur,
  externalUrl,
  headerAccessory,
  headerAccessoryClassName,
  allowEdit = true,
  className,
  dividerClassName,
  onPasteReplace,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  externalUrl?: string | null;
  headerAccessory?: string;
  headerAccessoryClassName?: string;
  allowEdit?: boolean;
  className?: string;
  dividerClassName?: string;
  onPasteReplace?: () => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const displayValue = String(value || '').trim();
  const iconClassName = 'h-3.5 w-3.5';
  const actions = (
    <div className="flex items-center gap-1.5 text-text-faint">
      {onPasteReplace ? (
        <HoverTooltip label={`Paste & replace ${label}`} asChild>
          <IconButton
            tone="accent"
            onClick={() => { void onPasteReplace(); }}
            ariaLabel={`Paste & replace ${label}`}
            icon={<Clipboard className={iconClassName} />}
          />
        </HoverTooltip>
      ) : null}
      {externalUrl ? (
        <HoverTooltip label={`Open ${label}`} asChild>
          <IconButton
            tone="accent"
            onClick={() => {
              window.open(externalUrl, '_blank', 'noopener,noreferrer');
            }}
            ariaLabel={`Open ${label} in external link`}
            icon={<ExternalLink className={iconClassName} />}
          />
        </HoverTooltip>
      ) : null}
      <HoverTooltip label={`Copy ${label}`} asChild>
        <IconButton
          tone="neutral"
          onClick={() => {
            if (!displayValue) return;
            navigator.clipboard.writeText(displayValue);
          }}
          ariaLabel={`Copy ${label}`}
          icon={<Copy className={iconClassName} />}
        />
      </HoverTooltip>
    </div>
  );

  return (
    <DetailsPanelRow
      label={label}
      headerAccessory={headerAccessory ? (
        <span className={headerAccessoryClassName || 'text-micro font-black uppercase tracking-wide text-text-soft'}>
          {headerAccessory}
        </span>
      ) : null}
      actions={actions}
      className={className ? `${className} last:border-b-0` : 'last:border-b-0'}
      dividerClassName={dividerClassName}
    >
      {allowEdit && isEditing ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            setIsEditing(false);
            onBlur();
          }}
          placeholder={placeholder}
          autoFocus
          className="h-8 w-full border-0 bg-transparent px-0 text-sm font-bold text-text-default outline-none ring-0"
        />
      ) : (
        allowEdit ? (
          // ds-raw-button: full-width text-left value row that enters inline edit on click, not a standard action button
          <button type="button" onClick={() => setIsEditing(true)} className="block w-full py-0 text-left">
            <p className="truncate text-sm font-bold text-text-default">{displayValue || placeholder}</p>
          </button>
        ) : (
          <p className="truncate text-sm font-bold text-text-default">{displayValue || placeholder}</p>
        )
      )}
    </DetailsPanelRow>
  );
}
