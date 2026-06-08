/**
 * Two entry points:
 *
 *   • `PageHeader` — page-level header. Locks the row at 44px so it aligns
 *     with the sidebar back button. Use at the top of a route (`src/app/.../page.tsx`).
 *     No padding/height escape hatch.
 *
 *   • `PaneHeader` — detail-pane / flyout / side-panel header. Same primitives,
 *     but exposes `rowClassName` for callers that legitimately need more
 *     vertical room (panels are not constrained by sidebar alignment). Using
 *     this for a page header will trigger a dev-mode warning.
 *
 * Building blocks under each (icon badge, label, count, tabs, status pill,
 * action bar, etc.) live in `./blocks` and can be reused inside custom shells.
 */
export { PaneHeader, paneHeaderRowClass } from './PaneHeader';
export { PageHeader } from './PageHeader';
export {
  PaneHeaderLabel,
  paneHeaderLabelEyebrowClass,
  paneHeaderLabelValueClass,
  PaneHeaderTitle,
  paneHeaderHighContrastTitleClass,
  PaneHeaderCount,
  PaneHeaderIconBadge,
  PaneHeaderCloseButton,
  PaneHeaderStatusPill,
  PaneHeaderTabs,
  PaneHeaderActionBar,
  PaneHeaderWeekNav,
  PaneHeaderPagination,
} from './blocks';
export type { PaneHeaderActionBarAction } from './blocks';
