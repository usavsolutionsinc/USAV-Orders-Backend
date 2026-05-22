'use client';

/**
 * Back-compat alias for the location-label DataMatrix. The component is
 * now the general-purpose {@link Gs1DataMatrix}; this file is kept so the
 * BinLabelPrinter / RackLabelPrinter imports don't need to be rewritten
 * for the existing v2 location flow.
 */

export { Gs1DataMatrix as LocationDataMatrix } from './Gs1DataMatrix';
