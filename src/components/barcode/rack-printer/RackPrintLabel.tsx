'use client';

import React from 'react';
import { LocationDataMatrix } from '../LocationDataMatrix';
import { bayHand, gs1LocationAi, noPad, pad2, rackCode, rackToLocation, type RackSegments } from '@/lib/barcode-routing';
import { useAuth } from '@/contexts/AuthContext';
import { orgWarehouseLabel } from '@/lib/branding/letterhead';

/**
 * The printed rack label (3″ × 2″ thermal stock). Larger code than the bin
 * label — mounted on the rack upright, read from across the aisle.
 */
export function RackPrintLabel({ segments, roomName, gln }: { segments: RackSegments; roomName: string; gln: string }) {
  const { user } = useAuth();
  const code = rackCode(segments);
  const ai = gs1LocationAi(rackToLocation(segments), { gln });
  return (
    <div className="label-print-card" style={labelCardStyle}>
      <div style={labelLeftStyle}>
        <div style={labelEyebrowStyle}>{orgWarehouseLabel(user?.organizationName || 'Workspace', 'Rack')}</div>
        <div style={labelCodeStyle}>{code}</div>
        {roomName && <div style={labelRoomStyle}>{roomName}</div>}
        <div style={labelHumanStyle}>
          Aisle {pad2(segments.aisle)} · Bay {pad2(segments.bay)} ({bayHand(segments.bay)})<br />
          Level {noPad(segments.level)} · whole rack
        </div>
      </div>
      <div style={labelQrStyle}>
        <LocationDataMatrix value={ai} size={115} />
      </div>
    </div>
  );
}

// 3in × 2in label stock — same media as the bin label so one printer can drive
// both flows. Rack code is fewer characters, so the typography is slightly
// larger for read-from-across-the-aisle scannability.
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
  fontSize: '7px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#666',
};
const labelCodeStyle: React.CSSProperties = {
  fontSize: '20px', fontWeight: 800, fontFamily: '"JetBrains Mono", monospace',
  letterSpacing: '-0.02em', marginTop: '4px', color: '#000', lineHeight: 1,
  whiteSpace: 'nowrap',
};
const labelRoomStyle: React.CSSProperties = {
  fontSize: '10px', fontWeight: 700, marginTop: '5px', color: '#0F172A',
};
const labelHumanStyle: React.CSSProperties = {
  fontSize: '8px', fontWeight: 600, marginTop: '3px', lineHeight: '1.35', color: '#333',
};
const labelQrStyle: React.CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
