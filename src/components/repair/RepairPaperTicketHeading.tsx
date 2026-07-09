'use client';

import React from 'react';

interface RepairPaperTicketHeadingProps {
  displayTicket: string;
  compact?: boolean;
}

/** Shared title block for every repair service paper surface. */
export function RepairPaperTicketHeading({ displayTicket, compact = false }: RepairPaperTicketHeadingProps) {
  return (
    <div className={compact ? 'mb-3 min-w-0' : 'mb-6 min-w-0'}>
      <h1 className={`mb-1 font-bold ${compact ? 'text-xl' : 'text-3xl'}`}>Repair Service</h1>
      <p className={`flex flex-wrap items-baseline gap-x-2 font-semibold ${compact ? 'text-sm' : 'text-lg'}`}>
        {displayTicket ? <span className="font-bold">{displayTicket}</span> : null}
        <span>Repair Ticket Number</span>
      </p>
    </div>
  );
}
