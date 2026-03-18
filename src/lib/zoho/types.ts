export interface ZohoPageContext {
  page?: number;
  per_page?: number;
  has_more_page?: boolean;
  report_name?: string;
  applied_filter?: string;
  sort_column?: string;
  sort_order?: string;
}

export interface ZohoListResponse<T, TKey extends string = string> {
  code: number;
  message?: string;
  page_context?: ZohoPageContext;
  [key: string]: unknown;
}

export interface ZohoItem {
  item_id: string;
  item_group_id?: string;
  name?: string;
  sku?: string;
  upc?: string;
  ean?: string;
  description?: string;
  item_type?: string;
  product_type?: string;
  status?: string;
  rate?: number | string;
  purchase_rate?: number | string;
  unit?: string;
  reorder_level?: number | string;
  initial_stock?: number | string;
  tax_id?: string;
  tax_name?: string;
  tax_percentage?: number | string;
  image_name?: string;
  image_document_id?: string;
  image_url?: string;
  available_stock?: number | string;
  stock_on_hand?: number | string;
  custom_fields?: unknown[];
  warehouses?: Array<{
    warehouse_id?: string;
    warehouse_name?: string;
    initial_stock?: number | string;
    warehouse_stock_on_hand?: number | string;
    warehouse_available_stock?: number | string;
    available_stock?: number | string;
    stock_on_hand?: number | string;
  }>;
  locations?: Array<{
    location_id?: string;
    location_name?: string;
    available_stock?: number | string;
    stock_on_hand?: number | string;
  }>;
  last_modified_time?: string;
}

export interface ZohoWarehouse {
  warehouse_id: string;
  warehouse_name: string;
  is_primary?: boolean;
  status?: string;
  address?: unknown;
}

export interface ZohoOrganization {
  organization_id: string;
  name?: string;
  is_default_org?: boolean;
  time_zone?: string;
  currency_code?: string;
}

export interface ZohoContact {
  contact_id: string;
  contact_type?: string;
  contact_name?: string;
  company_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  status?: string;
  billing_address?: unknown;
  shipping_address?: unknown;
  currency_id?: string;
  payment_terms?: number;
  custom_fields?: unknown[];
  last_modified_time?: string;
}

export interface ZohoSalesOrder {
  salesorder_id: string;
  salesorder_number?: string;
  reference_number?: string;
  status?: string;
  date?: string;
  shipment_date?: string;
  sub_total?: number | string;
  tax_total?: number | string;
  total?: number | string;
  currency_code?: string;
  shipping_charge?: number | string;
  line_items?: unknown[];
  billing_address?: unknown;
  shipping_address?: unknown;
  last_modified_time?: string;
}

export interface ZohoPackage {
  package_id: string;
  package_number?: string;
  status?: string;
  date?: string;
  line_items?: unknown[];
}

export interface ZohoShipmentOrder {
  shipmentorder_id: string;
  status?: string;
  date?: string;
  tracking_number?: string;
  carrier?: string;
}

export interface ZohoInvoice {
  invoice_id: string;
  invoice_number?: string;
  status?: string;
  date?: string;
  due_date?: string;
  total?: number | string;
  balance?: number | string;
  custom_fields?: unknown[];
}

export interface ZohoItemAdjustment {
  inventory_adjustment_id?: string;
  adjustment_id?: string;
  reference_number?: string;
  reason?: string;
  date?: string;
  line_items?: unknown[];
}

export interface CreateContactPayload {
  display_name: string;
  email?: string;
  phone?: string;
  mobile?: string;
  contact_type: 'customer' | 'vendor';
  billing_address?: unknown;
  shipping_address?: unknown;
  custom_fields?: unknown[];
}

export interface CreateSalesOrderPayload {
  customer_id: string;
  reference_number: string;
  salesorder_date: string;
  shipment_date?: string;
  line_items: unknown[];
  shipping_charge?: number;
  notes?: string;
}

export interface CreatePackagePayload {
  salesorder_id: string;
  date?: string;
  line_items: unknown[];
  notes?: string;
}

export interface CreateShipmentOrderPayload {
  package_ids: string[];
  date?: string;
  tracking_number?: string;
  carrier?: string;
  shipment_type?: string;
}

export interface CreateAdjustmentPayload {
  date: string;
  reason: string;
  reference_number?: string;
  line_items: unknown[];
}

export interface CreateInvoicePayload {
  customer_id: string;
  salesorder_id?: string;
  date?: string;
  due_date?: string;
  line_items?: unknown[];
  notes?: string;
}
