export type ShippedSearchField =
  | 'all'
  | 'order_id'
  | 'tracking'
  | 'product_title'
  | 'sku'
  | 'serial_number';

export interface ShippedSearchFieldConfig {
  id: ShippedSearchField;
  label: string;
  placeholder: string;
  helperText: string;
  fuzzyEnabled: boolean;
  fuzzyMinQueryLength: number;
}

export const SHIPPED_SEARCH_FIELDS: ShippedSearchFieldConfig[] = [
  {
    id: 'all',
    label: 'All',
    placeholder: 'Search order ID, tracking, product title, SKU, or serial #',
    helperText: 'Searches order ID, tracking #, title, SKU, and serial #. Product text is typo-tolerant.',
    fuzzyEnabled: true,
    fuzzyMinQueryLength: 3,
  },
  {
    id: 'order_id',
    label: 'Order ID',
    placeholder: 'Search order ID',
    helperText: 'Order ID search is precise: exact and prefix matches rank first.',
    fuzzyEnabled: false,
    fuzzyMinQueryLength: 0,
  },
  {
    id: 'tracking',
    label: 'Tracking #',
    placeholder: 'Search tracking number',
    helperText: 'Tracking search supports exact, partial, last-8, and normalized carrier matches.',
    fuzzyEnabled: false,
    fuzzyMinQueryLength: 0,
  },
  {
    id: 'product_title',
    label: 'Product Title',
    placeholder: 'Search product title',
    helperText: 'Product title search is typo-tolerant for faster lookup.',
    fuzzyEnabled: true,
    fuzzyMinQueryLength: 3,
  },
  {
    id: 'sku',
    label: 'SKU',
    placeholder: 'Search SKU',
    helperText: 'SKU search prefers exact and prefix matches, then fuzzy text matches.',
    fuzzyEnabled: true,
    fuzzyMinQueryLength: 3,
  },
  {
    id: 'serial_number',
    label: 'Serial #',
    placeholder: 'Search serial number',
    helperText: 'Serial search supports exact, partial, and typo-tolerant matching.',
    fuzzyEnabled: true,
    fuzzyMinQueryLength: 3,
  },
];

export const SHIPPED_SEARCH_FIELD_OPTIONS: Array<{
  id: ShippedSearchField;
  label: string;
  placeholder: string;
}> = SHIPPED_SEARCH_FIELDS.map(({ id, label, placeholder }) => ({
  id,
  label,
  placeholder,
}));

const SHIPPED_SEARCH_FIELD_CONFIG_MAP = SHIPPED_SEARCH_FIELDS.reduce<Record<ShippedSearchField, ShippedSearchFieldConfig>>(
  (acc, field) => {
    acc[field.id] = field;
    return acc;
  },
  {} as Record<ShippedSearchField, ShippedSearchFieldConfig>,
);

export function normalizeShippedSearchField(raw: string | null | undefined): ShippedSearchField {
  const value = String(raw || '').trim().toLowerCase();
  return (
    SHIPPED_SEARCH_FIELDS.find((option) => option.id === value)?.id
    ?? 'all'
  );
}

export function getShippedSearchFieldConfig(field: ShippedSearchField): ShippedSearchFieldConfig {
  return SHIPPED_SEARCH_FIELD_CONFIG_MAP[field] ?? SHIPPED_SEARCH_FIELD_CONFIG_MAP.all;
}

export function getShippedSearchPlaceholder(field: ShippedSearchField): string {
  return getShippedSearchFieldConfig(field).placeholder;
}

export function getShippedSearchHelperText(field: ShippedSearchField): string {
  return getShippedSearchFieldConfig(field).helperText;
}

export function supportsShippedFuzzySearch(field: ShippedSearchField): boolean {
  return getShippedSearchFieldConfig(field).fuzzyEnabled;
}
