import { useState } from 'react';
import { Clipboard, Copy, ExternalLink } from '@/components/Icons';
import { DetailsPanelRow } from '@/design-system/components/DetailsPanelRow';

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
    <div className="flex items-center gap-1.5 text-gray-400">
      {onPasteReplace ? (
        <button
          type="button"
          onClick={() => { void onPasteReplace(); }}
          className="transition-colors hover:text-blue-600"
          aria-label={`Paste & replace ${label}`}
          title={`Paste & replace ${label}`}
        >
          <Clipboard className={iconClassName} />
        </button>
      ) : null}
      {externalUrl ? (
        <button
          type="button"
          onClick={() => {
            window.open(externalUrl, '_blank', 'noopener,noreferrer');
          }}
          className="transition-colors hover:text-blue-700"
          aria-label={`Open ${label} in external link`}
          title={`Open ${label}`}
        >
          <ExternalLink className={iconClassName} />
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => {
          if (!displayValue) return;
          navigator.clipboard.writeText(displayValue);
        }}
        className="transition-colors hover:text-gray-900"
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
      >
        <Copy className={iconClassName} />
      </button>
    </div>
  );

  return (
    <DetailsPanelRow
      label={label}
      headerAccessory={headerAccessory ? (
        <span className={headerAccessoryClassName || 'text-micro font-black uppercase tracking-wide text-gray-500'}>
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
          className="h-8 w-full border-0 bg-transparent px-0 text-sm font-bold text-gray-900 outline-none ring-0"
        />
      ) : (
        allowEdit ? (
          <button type="button" onClick={() => setIsEditing(true)} className="block w-full py-0 text-left">
            <p className="truncate text-sm font-bold text-gray-900">{displayValue || placeholder}</p>
          </button>
        ) : (
          <p className="truncate text-sm font-bold text-gray-900">{displayValue || placeholder}</p>
        )
      )}
    </DetailsPanelRow>
  );
}
