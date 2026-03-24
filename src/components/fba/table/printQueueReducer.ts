import type { EnrichedItem, TableAction, TableState } from './types';
import { sortEnrichedItems } from './utils';

export function createInitialTableState(): TableState {
  return {
    items: [],
    selected: new Set(),
    loading: true,
    error: null,
    expandedItemId: null,
    viewMode: 'by_day',
    dayFilter: null,
  };
}

export function printQueueReducer(state: TableState, action: TableAction): TableState {
  switch (action.type) {
    case 'SET_ITEMS':
      return {
        ...state,
        items: action.payload.map((i) => ({ ...i, expanded: false })),
        selected: new Set(),
        expandedItemId: null,
        loading: false,
        error: null,
      };
    case 'REFRESH_ITEMS': {
      const nextItems = action.payload.map((i) => {
        const prev = state.items.find((p) => p.item_id === i.item_id);
        return {
          ...i,
          expanded: prev?.expanded ?? false,
        };
      });
      const validIds = new Set(nextItems.map((i) => i.item_id));
      const selected = new Set(Array.from(state.selected).filter((id) => validIds.has(id)));
      let expandedItemId = state.expandedItemId;
      if (expandedItemId != null && !validIds.has(expandedItemId)) expandedItemId = null;
      return {
        ...state,
        items: nextItems.map((i) => ({
          ...i,
          expanded: expandedItemId === i.item_id,
        })),
        selected,
        expandedItemId,
        loading: false,
        error: null,
      };
    }
    case 'TOGGLE_SELECT': {
      const next = new Set(state.selected);
      next.has(action.id) ? next.delete(action.id) : next.add(action.id);
      return { ...state, selected: next };
    }
    case 'SELECT_ALL':
      return { ...state, selected: new Set(state.items.map((i) => i.item_id)) };
    case 'DESELECT_ALL':
      return { ...state, selected: new Set() };
    case 'SELECT_SHIPMENT': {
      const ids = state.items.filter((i) => i.shipment_id === action.shipment_id).map((i) => i.item_id);
      const allSel = ids.length > 0 && ids.every((id) => state.selected.has(id));
      const next = new Set(state.selected);
      if (allSel) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return { ...state, selected: next };
    }
    case 'TOGGLE_EXPAND': {
      const open = state.expandedItemId === action.id ? null : action.id;
      return {
        ...state,
        expandedItemId: open,
        items: state.items.map((i) => ({ ...i, expanded: i.item_id === open })),
      };
    }
    case 'SET_EXPANDED': {
      const open = action.id;
      return {
        ...state,
        expandedItemId: open,
        items: state.items.map((i) => ({ ...i, expanded: open != null && i.item_id === open })),
      };
    }
    case 'PATCH_ITEM':
      return {
        ...state,
        items: state.items.map((i) =>
          i.item_id === action.id ? { ...i, ...action.patch } : i
        ),
      };
    case 'REMOVE_ITEM':
      return {
        ...state,
        items: state.items.filter((i) => i.item_id !== action.id),
        selected: (() => {
          const next = new Set(state.selected);
          next.delete(action.id);
          return next;
        })(),
        expandedItemId: state.expandedItemId === action.id ? null : state.expandedItemId,
      };
    case 'RESTORE_ITEM': {
      const merged = [...state.items, action.item].sort(sortEnrichedItems);
      return { ...state, items: merged };
    }
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode };
    case 'SET_DAY_FILTER':
      return { ...state, dayFilter: action.date };
    case 'SET_LOADING':
      return { ...state, loading: action.loading };
    case 'SET_ERROR':
      return { ...state, error: action.error, loading: false };
    default:
      return state;
  }
}
