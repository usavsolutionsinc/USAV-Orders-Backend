'use client';

import { useCallback, useEffect, useState } from 'react';

export interface UseImageZoom {
  zoomLevel: number;
  imagePosition: { x: number; y: number };
  isDragging: boolean;
  /** Clockwise rotation in degrees (0/90/180/270). */
  rotation: number;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  rotateCw: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
}

/**
 * Zoom (1×–3×) + click-drag panning for the fullscreen image. Dragging only
 * engages above 1×. All callbacks are stable so consumers can list them in
 * effect/callback dependency arrays.
 */
export function useImageZoom(): UseImageZoom {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);

  const zoomIn = useCallback(() => setZoomLevel((prev) => Math.min(prev + 0.5, 3)), []);
  const zoomOut = useCallback(() => setZoomLevel((prev) => Math.max(prev - 0.5, 1)), []);
  const rotateCw = useCallback(() => setRotation((prev) => (prev + 90) % 360), []);
  const resetZoom = useCallback(() => {
    setZoomLevel(1);
    setImagePosition({ x: 0, y: 0 });
    setIsDragging(false);
    setRotation(0);
  }, []);

  // End the pan on ANY mouseup — including releases outside the image or after
  // the viewer has unmounted (e.g. Esc pressed mid-drag). Without this, closing
  // mid-drag strands `isDragging`/`grabbing` state. The listener lives in this
  // hook (mounted with the gallery), so it fires even once the modal is gone.
  useEffect(() => {
    if (!isDragging) return;
    const onUp = () => setIsDragging(false);
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [isDragging]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (zoomLevel > 1) {
        setIsDragging(true);
        setDragStart({ x: e.clientX - imagePosition.x, y: e.clientY - imagePosition.y });
      }
    },
    [zoomLevel, imagePosition.x, imagePosition.y],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging && zoomLevel > 1) {
        setImagePosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
      }
    },
    [isDragging, zoomLevel, dragStart.x, dragStart.y],
  );

  const onMouseUp = useCallback(() => setIsDragging(false), []);

  return { zoomLevel, imagePosition, isDragging, rotation, zoomIn, zoomOut, resetZoom, rotateCw, onMouseDown, onMouseMove, onMouseUp };
}
