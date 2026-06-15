'use client';

import { Gs1DataMatrix } from '@/components/barcode/Gs1DataMatrix';
import type { LabelFaceModel } from '@/lib/print/labelFace';

/**
 * On-screen render of a printed 2×1" label face from a {@link LabelFaceModel}.
 * The single preview shared by the receiving (PO/carton) and testing (unit)
 * labels — both feed it a model built by their domain adapter, so the preview
 * and the printed sticker can never drift. `embedded` strips the bordered card
 * chrome for use inside a menu/popover.
 *
 * Row height is pinned to the 96px (6rem) DataMatrix so the text column spans
 * the same box: with no vertical padding the top row (topLeft · topRight) sits
 * flush with the matrix's top edge and the bottom row (bottomLeft · bottomRight)
 * with its bottom edge.
 */
export function LabelFacePreview({
  model,
  embedded,
}: {
  model: LabelFaceModel;
  embedded?: boolean;
}) {
  const shell = embedded
    ? 'w-full bg-white'
    : 'w-full rounded-lg border border-gray-200/80 bg-white px-3 py-3 shadow-sm';
  // quietZone=0 makes the ink fill the box edge-to-edge so the top/bottom rows
  // line up with the matrix's visible edges — preview only; the printed symbol
  // keeps its scanner-safe quiet zone.
  const matrixCol = (
    <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 [&_svg]:block">
      {model.matrix.value ? (
        <Gs1DataMatrix
          value={model.matrix.value}
          size={84}
          symbology={model.matrix.symbology}
          quietZone={0}
        />
      ) : null}
      {model.hri ? (
        <span className="font-mono text-[7px] font-extrabold leading-none tracking-wide text-gray-900">
          {model.hri}
        </span>
      ) : null}
    </div>
  );

  // Product face — product title fills a full top row, condition·color beneath.
  if (model.kind === 'product') {
    return (
      <div className={shell}>
        <div className="flex min-h-[6rem] flex-nowrap items-stretch gap-4">
          <div className="min-w-0 flex flex-1 flex-col justify-between">
            <span className="line-clamp-2 text-micro font-bold leading-snug tracking-tight text-black">
              {model.topLeft}
            </span>
            <div className="flex items-baseline justify-between gap-2 text-micro leading-none">
              <span className="font-black text-black">{model.bottomLeft}</span>
              <span className="shrink-0 tabular-nums font-black text-black">
                {model.bottomRight}
              </span>
            </div>
          </div>
          {matrixCol}
        </div>
      </div>
    );
  }

  // Receiving face — 4-corner carton grid.
  return (
    <div className={shell}>
      <div className="flex min-h-[6rem] flex-nowrap items-stretch gap-4">
        <div className="min-w-0 flex flex-1 flex-col justify-between">
          <div className="flex items-baseline justify-between gap-2 text-base leading-none">
            <span className="truncate font-bold text-gray-900">{model.topLeft}</span>
            <span className="shrink-0 tabular-nums font-bold text-gray-900">
              {model.topRight}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 min-w-0 items-center justify-center px-0.5">
            <span className="line-clamp-3 w-full text-center text-caption font-semibold leading-tight tracking-normal text-gray-900 normal-case">
              {model.center}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-base leading-none">
            <span className="font-black text-gray-900">{model.bottomLeft}</span>
            <span className="shrink-0 tabular-nums font-black text-gray-900">
              {model.bottomRight}
            </span>
          </div>
        </div>
        {matrixCol}
      </div>
    </div>
  );
}
