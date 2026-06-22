'use client';

import {
  useFavoritesWorkspace,
  type FavoritesWorkspaceSectionProps,
} from './favorites/useFavoritesWorkspace';
import { FavoritesQuickPickView } from './favorites/FavoritesQuickPickView';
import { FavoritesDefaultView } from './favorites/FavoritesDefaultView';

/**
 * Per-workspace SKU favorites: load + Ecwid-search-backed create/edit/delete, in
 * a quick-pick tile grid or a collapsible row list. Thin composition layer —
 * state/logic live under `./favorites/`.
 */
export function FavoritesWorkspaceSection(props: FavoritesWorkspaceSectionProps) {
  const f = useFavoritesWorkspace(props);
  return f.isQuickPick ? <FavoritesQuickPickView f={f} /> : <FavoritesDefaultView f={f} />;
}
