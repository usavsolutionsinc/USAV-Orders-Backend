'use client';

import { SkeletonBase } from '@/design-system';
import {
  RECEIVING_WORKSPACE_BODY_COLUMN,
  RECEIVING_WORKSPACE_HEADER_COLUMN,
} from './receiving-workspace-layout';

/** Stacked section cards that mirror LineEditPanel's hero column shape. */
export function ReceivingWorkspaceSkeletonSections() {
  return (
    <>
      <ReceivingWorkspaceSkeletonSection rows={2} />
      <ReceivingWorkspaceSkeletonSection rows={3} />
      <ReceivingWorkspaceSkeletonSection rows={2} />
    </>
  );
}

export function ReceivingWorkspaceSkeletonSection({ rows }: { rows: number }) {
  return (
    <div className="rounded-2xl border border-border-soft bg-surface-card px-5 py-4 shadow-sm">
      <SkeletonBase width="96px" height="10px" className="mb-3 rounded-full" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonBase
            key={i}
            width={`${100 - i * 12}%`}
            height="12px"
            className="rounded-full"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Right-pane idle / loading skeleton for the Unbox workspace. Mirrors the
 * stepper + action bar + centered 720px section stack so the handoff to
 * LineEditPanel feels continuous. Uses design-system `SkeletonBase` primitives.
 */
export function ReceivingWorkspaceSkeleton({ showHeader = true }: { showHeader?: boolean }) {
  return (
    <div className="flex h-full w-full flex-col bg-surface-canvas" aria-busy="true" aria-label="Loading workspace">
      {showHeader ? (
        <>
          <div className="shrink-0 border-b border-border-hairline bg-surface-card">
            <div className={`${RECEIVING_WORKSPACE_HEADER_COLUMN} flex h-10 items-center justify-center gap-2`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonBase key={i} width={`${56 + (i % 2) * 12}px`} height="24px" className="rounded-full" />
              ))}
            </div>
          </div>
          <div className="flex h-10 shrink-0 items-center border-b border-border-hairline bg-surface-card">
            <div className={`${RECEIVING_WORKSPACE_HEADER_COLUMN} flex items-center justify-between`}>
              <div className="flex items-center gap-2">
                <SkeletonBase width="72px" height="28px" className="rounded-full" />
                <SkeletonBase width="88px" height="28px" className="rounded-full" />
              </div>
              <div className="flex items-center gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonBase key={i} circle width="32px" height="32px" />
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className={RECEIVING_WORKSPACE_BODY_COLUMN}>
          <ReceivingWorkspaceSkeletonSections />
        </div>
      </div>
    </div>
  );
}
