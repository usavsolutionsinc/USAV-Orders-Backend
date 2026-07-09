/**
 * Station table selection scopes (station-table-unification-plan §5.4). Each
 * bulk-select surface broadcasts on a stable scope string shared by the table's
 * `useTableSelectMode` and any action bar. Tech + Packer are the new scopes;
 * Testing + Receiving already have `'testing'` / `'receiving'`.
 */
export const TECH_HISTORY_SELECTION_SCOPE = 'tech-history' as const;
export const PACKER_HISTORY_SELECTION_SCOPE = 'packer-history' as const;
