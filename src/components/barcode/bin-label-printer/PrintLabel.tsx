'use client';

import type React from 'react';
import { LocationDataMatrix } from '../LocationDataMatrix';
import {
  bayHand,
  gs1LocationAi,
  locationCode,
  noPad,
  pad2,
  type LocationSegments,
} from '@/lib/barcode-routing';
import { useAuth } from '@/contexts/AuthContext';
import { orgWarehouseLabel } from '@/lib/branding/letterhead';

interface PrintLabelProps {
  segments: LocationSegments;
  roomName: string;
  gln: string;
}

/**
 * 3″ × 2″ printable thermal label card.
 * Sized to fill the @page declaration in globals.css.
 */
export function PrintLabel({ segments, roomName, gln }: PrintLabelProps) {
  const { user } = useAuth();
  const code = locationCode(segments);
  const ai = gs1LocationAi(segments, { gln });
  return (
    <div className="label-print-card" style={labelCardStyle}>
      <div style={labelLeftStyle}>
        <div style={labelEyebrowStyle}>{orgWarehouseLabel(user?.organizationName || 'Workspace', 'Location')}</div>
        <div style={labelCodeStyle}>{code}</div>
        {roomName && <div style={labelRoomStyle}>{roomName}</div>}
        <div style={labelHumanStyle}>
          Aisle {pad2(segments.aisle)} · Bay {pad2(segments.bay)} ({bayHand(segments.bay)})
          <br />
          Level {noPad(segments.level)} · Position {pad2(segments.position)}
        </div>
      </div>
      <div style={labelQrStyle}>
        <LocationDataMatrix value={ai} size={110} />
      </div>
    </div>
  );
}

const labelCardStyle: React.CSSProperties = {
  width: '3in',
  height: '2in',
  margin: 0,
  padding: '0.12in',
  display: 'inline-flex',
  alignItems: 'flex-start',
  gap: '0.1in',
  verticalAlign: 'top',
  fontFamily: '"Inter", "Arial", sans-serif',
  color: '#000',
  background: '#fff',
  boxSizing: 'border-box',
  overflow: 'hidden',
};
const labelLeftStyle: React.CSSProperties = { flex: '1 1 auto', minWidth: 0 };
const labelEyebrowStyle: React.CSSProperties = {
  fontSize: '7px',
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#666',
};
const labelCodeStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 800,
  fontFamily: '"JetBrains Mono", monospace',
  letterSpacing: '-0.02em',
  marginTop: '4px',
  color: '#000',
  lineHeight: 1,
  whiteSpace: 'nowrap',
};
const labelRoomStyle: React.CSSProperties = {
  fontSize: '9px',
  fontWeight: 700,
  marginTop: '4px',
  color: '#0F172A',
};
const labelHumanStyle: React.CSSProperties = {
  fontSize: '7.5px',
  fontWeight: 600,
  marginTop: '3px',
  lineHeight: '1.35',
  color: '#333',
};
const labelQrStyle: React.CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
