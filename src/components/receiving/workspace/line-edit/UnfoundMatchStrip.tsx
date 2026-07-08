'use client';

/**
 * Compact auto-match row for an UNFOUND carton — lives inside
 * {@link POUnboxingSection} below PO Items, above Package Pairing (always
 * visible, not behind the pairing collapse). Operator-initiated only; the scan
 * path never pings Zoho or Amazon (see useUnfoundRefetchActions).
 */

import type { ComponentType, SVGProps } from 'react';
import { RotateCcw, Search, Check, Info, AlertTriangle } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  useUnfoundRefetchActions,
  type RefetchState,
} from './hooks/useUnfoundRefetchActions';
import { pickMergedRefetchNotice } from './hooks/useUnfoundRefetchActions.classify';
import { WorkspaceSectionTitle } from '../WorkspaceSectionLabel';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface UnfoundMatchStripProps {
  receivingId: number | null;
  trackingNumber: string | null;
  /** When false, omit top divider (e.g. first block in a pairing-only card). */
  showTopRule?: boolean;
}

export function UnfoundMatchStrip({
  receivingId,
  trackingNumber,
  showTopRule = true,
}: UnfoundMatchStripProps) {
  const { zoho, amazon, busy, checkZoho, checkAmazon } = useUnfoundRefetchActions(
    receivingId,
    trackingNumber,
  );
  const hasTracking = Boolean(trackingNumber?.trim());
  const noReceiving = receivingId == null;
  const notice = pickMergedRefetchNotice(zoho, amazon);

  return (
    <div
      className={showTopRule ? 'space-y-2 border-t border-border-hairline pt-3' : 'space-y-2'}
    >
      <WorkspaceSectionTitle as="p">Auto-match</WorkspaceSectionTitle>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <StripButton
          icon={RotateCcw}
          label="Zoho"
          tooltip="Search Zoho by tracking — re-run the PO tracking search"
          state={zoho}
          disabled={noReceiving || busy}
          onClick={() => void checkZoho()}
        />
        <StripButton
          icon={Search}
          label="Amazon return"
          tooltip={
            hasTracking
              ? 'Match by reverse tracking ID (Amazon Returns SP-API)'
              : 'Add a tracking number to this carton first'
          }
          state={amazon}
          disabled={noReceiving || !hasTracking || busy}
          onClick={() => void checkAmazon()}
        />
      </div>
      {notice ? <MergedNotice state={notice} /> : null}
    </div>
  );
}

function StripButton({
  icon: Icon,
  label,
  tooltip,
  state,
  disabled,
  onClick,
}: {
  icon: IconComponent;
  label: string;
  tooltip: string;
  state: RefetchState;
  disabled: boolean;
  onClick: () => void;
}) {
  const button = (
    <Button
      variant="secondary"
      size="sm"
      loading={state.status === 'loading'}
      disabled={disabled}
      onClick={onClick}
      className="min-h-11 w-full justify-start gap-2 rounded-lg px-3"
      icon={<Icon className="h-4 w-4 shrink-0" />}
    >
      <span className="truncate text-caption font-bold">{label}</span>
    </Button>
  );

  return (
    <HoverTooltip label={tooltip} asChild focusable={false}>
      {button}
    </HoverTooltip>
  );
}

function MergedNotice({ state }: { state: RefetchState }) {
  if (!state.message) return null;

  const tone =
    state.status === 'matched'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : state.status === 'error' || state.status === 'unsupported'
        ? 'bg-rose-50 text-rose-700 ring-rose-200'
        : 'bg-surface-canvas text-text-muted ring-border-soft';
  const Icon =
    state.status === 'matched'
      ? Check
      : state.status === 'error' || state.status === 'unsupported'
        ? AlertTriangle
        : Info;

  return (
    <div
      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-caption ring-1 ring-inset ${tone}`}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">{state.message}</span>
    </div>
  );
}
