'use client';

/**
 * General-purpose DataMatrix renderer used by every printed label in the
 * app — locations, racks, unit/serial product labels, receiving cartons,
 * receiving lines, repair tickets. Two symbology modes:
 *
 *   • `gs1datamatrix` — payload is GS1 AI string in parens form
 *                       (e.g. `(414){gln}(254){code}`, `(01){gtin}(21){serial}`).
 *                       bwip-js inserts the FNC1 control character on the
 *                       wire so industrial scanners decode the AIs natively.
 *
 *   • `datamatrix`    — plain DataMatrix carrying an arbitrary string
 *                       (e.g. `R-1234`, `L-567`, `REP-89`). Used for
 *                       internal handles where there's no natural GS1 AI.
 *
 * Either way the rendered symbol is opaque to consumer phone cameras —
 * no clickable URL, no backend hostname. The internal app's scanner
 * (`/m/scan` + `routeScan()`) is the only surface that turns it into
 * navigation.
 */

import { useMemo } from 'react';
import { renderDataMatrixSvg, type DataMatrixSymbology } from '@/lib/barcode/dataMatrixSvg';

export type Gs1DataMatrixSymbology = DataMatrixSymbology;

interface Gs1DataMatrixProps {
  /** Payload to encode. AI parens form for `gs1datamatrix`, plain text for `datamatrix`. */
  value: string;
  /** Side length in CSS pixels (DataMatrix is always square). */
  size: number;
  /** Symbology — defaults to `gs1datamatrix` (the common case). */
  symbology?: Gs1DataMatrixSymbology;
  /** Foreground colour. Defaults to pure black for thermal print contrast. */
  fgColor?: string;
  /** Background colour. Defaults to white. */
  bgColor?: string;
  /** ARIA label for screen readers. */
  ariaLabel?: string;
}

export function Gs1DataMatrix({
  value,
  size,
  symbology = 'gs1datamatrix',
  fgColor = '#000000',
  bgColor = '#FFFFFF',
  ariaLabel,
}: Gs1DataMatrixProps) {
  const svgMarkup = useMemo(() => {
    try {
      return renderDataMatrixSvg({
        value,
        symbology,
        barcolor: fgColor.replace('#', ''),
        backgroundcolor: bgColor.replace('#', ''),
      });
    } catch (err) {
      console.error('[Gs1DataMatrix] failed to render', err);
      return null;
    }
  }, [value, symbology, fgColor, bgColor]);

  const label =
    ariaLabel ??
    (symbology === 'gs1datamatrix' ? 'GS1 DataMatrix barcode' : 'DataMatrix barcode');

  if (!svgMarkup) {
    return (
      <div
        role="img"
        aria-label="Barcode render failed"
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fef2f2',
          color: '#991b1b',
          fontSize: 10,
          fontWeight: 600,
          textAlign: 'center',
          padding: 4,
          boxSizing: 'border-box',
        }}
      >
        Barcode failed
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={label}
      style={{ width: size, height: size, lineHeight: 0 }}
      // bwip-js returns trusted, machine-generated SVG. Safe to inject.
      dangerouslySetInnerHTML={{
        __html: svgMarkup.replace(
          /<svg([^>]*)>/,
          `<svg$1 width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`,
        ),
      }}
    />
  );
}
