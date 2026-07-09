'use client';

import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ChevronDown } from '@/components/Icons';
import { ScrollPane } from '@/design-system/primitives/ScrollPane';
import { useVerticalSplitDrag } from '@/design-system/hooks/useVerticalSplitDrag';
import { cn } from '@/utils/_cn';

const SECTION_DISPLAY = 'VerticalSplitStack.Section';
const DIVIDER_DISPLAY = 'VerticalSplitStack.Divider';

/* ── Context ─────────────────────────────────────────────────────────────── */

interface SplitStackContextValue {
  persistKey?: string;
  resizable: boolean;
  ratio: number;
  isDragging: boolean;
  dividerProps: ReturnType<typeof useVerticalSplitDrag>['dividerProps'];
  collapsedByIndex: boolean[];
  setCollapsedAt: (index: number, collapsed: boolean) => void;
  sectionCount: number;
}

const SplitStackContext = createContext<SplitStackContextValue | null>(null);

function useSplitStack() {
  const ctx = useContext(SplitStackContext);
  if (!ctx) throw new Error('VerticalSplitStack.Section must render inside VerticalSplitStack');
  return ctx;
}

function componentDisplayName(type: unknown): string | undefined {
  if (typeof type === 'function') {
    return (type as { displayName?: string }).displayName;
  }
  return undefined;
}

function isSplitSection(child: ReactNode): child is ReactElement<VerticalSplitStackSectionProps> {
  if (!isValidElement(child)) return false;
  return (
    child.type === VerticalSplitStackSection ||
    componentDisplayName(child.type) === SECTION_DISPLAY
  );
}

function isSplitDivider(child: ReactNode): child is ReactElement {
  if (!isValidElement(child)) return false;
  return (
    child.type === VerticalSplitStackDivider ||
    componentDisplayName(child.type) === DIVIDER_DISPLAY
  );
}

function initialCollapsedFromChildren(childArray: ReactNode[]): boolean[] {
  const out: boolean[] = [];
  for (const child of childArray) {
    if (!isSplitSection(child)) continue;
    const props = child.props as VerticalSplitStackSectionProps;
    out.push(props.collapsed ?? props.defaultCollapsed ?? false);
  }
  return out;
}

function resolveSectionCollapsed(
  props: VerticalSplitStackSectionProps,
  index: number,
  collapsedByIndex: boolean[],
): boolean {
  if (props.collapsed != null) return props.collapsed;
  if (collapsedByIndex[index] != null) return collapsedByIndex[index];
  return props.defaultCollapsed ?? false;
}

/* ── Persisted collapse ──────────────────────────────────────────────────── */

function useSectionCollapsed(
  persistKey: string | undefined,
  sectionId: string | undefined,
  defaultCollapsed: boolean,
  controlled: boolean | undefined,
  onControlledChange: ((collapsed: boolean) => void) | undefined,
) {
  const storageKey =
    persistKey && sectionId ? `${persistKey}.section.${sectionId}.collapsed` : null;

  const [internal, setInternal] = useState(defaultCollapsed);

  useEffect(() => {
    if (!storageKey || controlled != null) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw !== null) setInternal(raw === '1');
    } catch {
      /* noop */
    }
  }, [storageKey, controlled]);

  const collapsed = controlled ?? internal;

  const setCollapsed = useCallback(
    (next: boolean) => {
      if (onControlledChange) onControlledChange(next);
      else setInternal(next);
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, next ? '1' : '0');
        } catch {
          /* noop */
        }
      }
    },
    [onControlledChange, storageKey],
  );

  return [collapsed, setCollapsed] as const;
}

/* ── Root ────────────────────────────────────────────────────────────────── */

export interface VerticalSplitStackProps {
  children: ReactNode;
  className?: string;
  /** localStorage namespace for split ratio + per-section collapse. */
  persistKey?: string;
  /** Enable drag divider between open sections. */
  resizable?: boolean;
  defaultRatio?: number;
}

export function VerticalSplitStack({
  children,
  className,
  persistKey,
  resizable = false,
  defaultRatio,
}: VerticalSplitStackProps) {
  const childArray = useMemo(
    () => Children.toArray(children).filter(Boolean),
    [children],
  );

  const sectionCount = useMemo(
    () => childArray.filter((c) => isSplitSection(c)).length,
    [childArray],
  );

  const [collapsedByIndex, setCollapsedByIndex] = useState<boolean[]>(() =>
    initialCollapsedFromChildren(childArray),
  );

  useEffect(() => {
    setCollapsedByIndex((prev) => {
      const seeded = initialCollapsedFromChildren(childArray);
      if (seeded.length === 0) return prev;
      return seeded.map((v, i) => {
        const props = childArray.filter(isSplitSection)[i]?.props as
          | VerticalSplitStackSectionProps
          | undefined;
        if (props?.collapsed != null) return props.collapsed;
        if (prev[i] != null) return prev[i];
        return v;
      });
    });
  }, [childArray, sectionCount]);

  const setCollapsedAt = useCallback((index: number, collapsed: boolean) => {
    setCollapsedByIndex((prev) => {
      const next = [...prev];
      next[index] = collapsed;
      return next;
    });
  }, []);

  const openSectionCount = useMemo(() => {
    let index = -1;
    return childArray.reduce<number>((count, child) => {
      if (!isSplitSection(child)) return count;
      index += 1;
      const props = child.props as VerticalSplitStackSectionProps;
      const isCollapsed = resolveSectionCollapsed(props, index, collapsedByIndex);
      return isCollapsed ? count : count + 1;
    }, 0);
  }, [childArray, collapsedByIndex]);

  const dragEnabled = resizable && openSectionCount >= 2;

  const { ratio, isDragging, dividerProps } = useVerticalSplitDrag({
    persistKey,
    defaultRatio,
    enabled: dragEnabled,
  });

  const ctx: SplitStackContextValue = useMemo(
    () => ({
      persistKey,
      resizable: dragEnabled,
      ratio,
      isDragging,
      dividerProps,
      collapsedByIndex,
      setCollapsedAt,
      sectionCount,
    }),
    [
      persistKey,
      dragEnabled,
      ratio,
      isDragging,
      dividerProps,
      collapsedByIndex,
      setCollapsedAt,
      sectionCount,
    ],
  );

  const rendered = useMemo(() => {
    const nodes: ReactNode[] = [];
    let sectionIndex = -1;
    let openSectionCounter = 0;
    let prevSectionOpen = false;

    for (const child of childArray) {
      if (isSplitDivider(child)) continue;

      if (isSplitSection(child)) {
        sectionIndex += 1;
        const idx = sectionIndex;
        const props = child.props as VerticalSplitStackSectionProps;
        const isCollapsed = resolveSectionCollapsed(props, idx, collapsedByIndex);
        const openIndex = isCollapsed ? -1 : openSectionCounter;

        if (dragEnabled && prevSectionOpen && !isCollapsed) {
          nodes.push(
            <SplitDivider
              key={`split-divider-${idx}`}
              isDragging={isDragging}
              {...dividerProps}
            />,
          );
        }

        if (!isCollapsed) {
          openSectionCounter += 1;
          prevSectionOpen = true;
        } else {
          prevSectionOpen = false;
        }

        nodes.push(
          cloneElement(child as ReactElement<SectionInternalProps>, {
            ...({ _index: idx, _openIndex: openIndex, _openSectionCount: openSectionCount } as SectionInternalProps),
            key: child.key ?? `section-${idx}`,
          }),
        );
        continue;
      }

      nodes.push(child);
    }

    return nodes;
  }, [childArray, collapsedByIndex, dragEnabled, dividerProps, isDragging, openSectionCount]);

  return (
    <SplitStackContext.Provider value={ctx}>
      <div className={cn('flex min-h-0 flex-1 flex-col', className)}>{rendered}</div>
    </SplitStackContext.Provider>
  );
}

/* ── Divider ─────────────────────────────────────────────────────────────── */

function SplitDivider({
  isDragging,
  className,
  ...props
}: SplitStackContextValue['dividerProps'] & { isDragging: boolean; className?: string }) {
  return (
    <div
      {...props}
      className={cn(
        'group/grip relative z-10 flex h-3 shrink-0 cursor-row-resize items-center justify-center border-y border-border-soft transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300',
        isDragging ? 'bg-blue-100' : 'bg-surface-sunken hover:bg-blue-50',
        className,
      )}
    >
      <span
        className={cn(
          'h-[3px] w-10 rounded-full transition-colors',
          isDragging ? 'bg-blue-500' : 'bg-surface-strong group-hover/grip:bg-blue-400',
        )}
      />
    </div>
  );
}

/** Optional marker — dividers auto-inject between open sections when resizable. */
function VerticalSplitStackDivider(_props: { className?: string }) {
  return null;
}
VerticalSplitStackDivider.displayName = DIVIDER_DISPLAY;

/* ── Section ───────────────────────────────────────────────────────────── */

export interface VerticalSplitStackSectionProps {
  id?: string;
  title?: ReactNode;
  badge?: ReactNode;
  headerRight?: ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  flex?: number;
  minHeight?: number;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  disableScroll?: boolean;
}

interface SectionInternalProps extends VerticalSplitStackSectionProps {
  _index?: number;
  _openIndex?: number;
  _openSectionCount?: number;
}

function VerticalSplitStackSection({
  id,
  title,
  badge,
  headerRight,
  collapsible = false,
  defaultCollapsed = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  flex = 1,
  minHeight = 80,
  children,
  className,
  bodyClassName,
  disableScroll = false,
  _index = 0,
  _openIndex = 0,
  _openSectionCount,
}: SectionInternalProps) {
  const ctx = useSplitStack();
  const [collapsed, setCollapsed] = useSectionCollapsed(
    ctx.persistKey,
    id,
    defaultCollapsed,
    controlledCollapsed,
    onCollapsedChange,
  );

  useEffect(() => {
    ctx.setCollapsedAt(_index, collapsed);
  }, [_index, collapsed, ctx.setCollapsedAt]);

  const openCount = _openSectionCount ?? ctx.collapsedByIndex.filter((c) => !c).length;
  const showHeader = title != null || badge != null || headerRight != null || collapsible;

  let flexStyle: React.CSSProperties | undefined;

  if (collapsed) {
    flexStyle = { flex: '0 0 auto' };
  } else if (ctx.resizable && openCount >= 2 && _openIndex >= 0) {
    const topRatio = ctx.ratio;
    const weight = _openIndex === 0 ? topRatio : 1 - topRatio;
    flexStyle = { flex: `${weight} 1 0%`, minHeight };
  } else {
    flexStyle = { flex: `${flex} 1 0%`, minHeight };
  }

  const pinToBottom = collapsible && collapsed;

  const toggleCollapsed = () => {
    if (!collapsible) return;
    const next = !collapsed;
    setCollapsed(next);
    ctx.setCollapsedAt(_index, next);
  };

  return (
    <section
      className={cn('flex min-h-0 flex-col', pinToBottom && 'mt-auto', className)}
      style={flexStyle}
      aria-expanded={collapsible ? !collapsed : undefined}
    >
      {showHeader ? (
        collapsible ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex shrink-0 items-center justify-between gap-2 px-1 py-1 text-left"
            aria-expanded={!collapsed}
          >
            <SectionHeader title={title} badge={badge} chevron collapsed={collapsed} />
            {headerRight}
          </button>
        ) : (
          <div className="flex shrink-0 items-center justify-between gap-2 px-1 py-1">
            <SectionHeader title={title} badge={badge} />
            {headerRight}
          </div>
        )
      ) : null}

      {!collapsed ? (
        disableScroll ? (
          <div className={cn('flex min-h-0 flex-1 flex-col', bodyClassName)}>{children}</div>
        ) : (
          <ScrollPane className={bodyClassName}>{children}</ScrollPane>
        )
      ) : null}
    </section>
  );
}
VerticalSplitStackSection.displayName = SECTION_DISPLAY;

function SectionHeader({
  title,
  badge,
  chevron = false,
  collapsed = false,
}: {
  title?: ReactNode;
  badge?: ReactNode;
  chevron?: boolean;
  collapsed?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-eyebrow font-black uppercase tracking-wider text-text-soft">
      {chevron ? (
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', collapsed ? '-rotate-90' : '')}
        />
      ) : null}
      {title}
      {badge != null && badge !== false ? (
        typeof badge === 'number' || typeof badge === 'string' ? (
          <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-mini font-black tabular-nums text-text-muted">
            {badge}
          </span>
        ) : (
          badge
        )
      ) : null}
    </span>
  );
}

VerticalSplitStack.Section = VerticalSplitStackSection;
VerticalSplitStack.Divider = VerticalSplitStackDivider;
