import { paginateZohoList, zohoDelete, zohoGet, zohoPost, zohoPut } from '@/lib/zoho/httpClient';
import type {
  CreateAdjustmentPayload,
  CreateContactPayload,
  CreateInvoicePayload,
  CreatePackagePayload,
  CreatePaymentPayload,
  CreateSalesOrderPayload,
  CreateShipmentOrderPayload,
  ZohoContact,
  ZohoInvoice,
  ZohoItem,
  ZohoItemAdjustment,
  ZohoListResponse,
  ZohoOrganization,
  ZohoPackage,
  ZohoSalesOrder,
  ZohoShipmentOrder,
  ZohoWarehouse,
} from '@/lib/zoho/types';

type Query = Record<string, string | number | boolean | null | undefined>;

export class ZohoInventoryClient {
  async listItems(params: Query = {}): Promise<ZohoListResponse<ZohoItem> & { items?: ZohoItem[] }> {
    return zohoGet('/api/v1/items', params);
  }

  paginateItems(params: Query = {}) {
    return paginateZohoList<ZohoItem>('/api/v1/items', 'items', params);
  }

  async getItem(itemId: string): Promise<ZohoItem> {
    const res = await zohoGet<{ item?: ZohoItem }>(`/api/v1/items/${encodeURIComponent(itemId)}`);
    if (!res.item) throw new Error(`Zoho item not found: ${itemId}`);
    return res.item;
  }

  async createItem(payload: Record<string, unknown>): Promise<ZohoItem> {
    const res = await zohoPost<{ item?: ZohoItem }>('/api/v1/items', payload);
    if (!res.item) throw new Error('Zoho item create returned no item');
    return res.item;
  }

  async updateItem(itemId: string, payload: Record<string, unknown>): Promise<ZohoItem> {
    const res = await zohoPut<{ item?: ZohoItem }>(`/api/v1/items/${encodeURIComponent(itemId)}`, payload);
    if (!res.item) throw new Error(`Zoho item update returned no item for ${itemId}`);
    return res.item;
  }

  async markItemInactive(itemId: string): Promise<void> {
    await zohoPost(`/api/v1/items/${encodeURIComponent(itemId)}/inactive`, {});
  }

  async listWarehouses(params: Query = {}): Promise<ZohoListResponse<ZohoWarehouse> & { warehouses?: ZohoWarehouse[] }> {
    return zohoGet('/api/v1/warehouses', params);
  }

  paginateWarehouses(params: Query = {}) {
    return paginateZohoList<ZohoWarehouse>('/api/v1/warehouses', 'warehouses', params);
  }

  async listOrganizations(): Promise<ZohoListResponse<ZohoOrganization> & { organizations?: ZohoOrganization[] }> {
    return zohoGet('/api/v1/organizations');
  }

  async findContactByEmail(email: string): Promise<ZohoContact | null> {
    const res = await zohoGet<ZohoListResponse<ZohoContact> & { contacts?: ZohoContact[] }>(
      '/api/v1/contacts',
      { email }
    );
    return res.contacts?.[0] ?? null;
  }

  async createContact(payload: CreateContactPayload): Promise<ZohoContact> {
    const res = await zohoPost<{ contact?: ZohoContact }>('/api/v1/contacts', payload);
    if (!res.contact) throw new Error('Zoho contact create returned no contact');
    return res.contact;
  }

  async createSalesOrder(payload: CreateSalesOrderPayload): Promise<ZohoSalesOrder> {
    const res = await zohoPost<{ salesorder?: ZohoSalesOrder }>('/api/v1/salesorders', payload);
    if (!res.salesorder) throw new Error('Zoho sales order create returned no salesorder');
    return res.salesorder;
  }

  async findSalesOrderByReference(referenceNumber: string): Promise<ZohoSalesOrder | null> {
    const res = await zohoGet<ZohoListResponse<ZohoSalesOrder> & { salesorders?: ZohoSalesOrder[] }>(
      '/api/v1/salesorders',
      { reference_number: referenceNumber }
    );
    return res.salesorders?.[0] ?? null;
  }

  /** Full sales-order detail, including `line_items` (with `line_item_id`) and `customer_id`. */
  async getSalesOrder(soId: string): Promise<ZohoSalesOrder> {
    const res = await zohoGet<{ salesorder?: ZohoSalesOrder }>(
      `/api/v1/salesorders/${encodeURIComponent(soId)}`
    );
    if (!res.salesorder) throw new Error(`Zoho sales order not found: ${soId}`);
    return res.salesorder;
  }

  async confirmSalesOrder(soId: string): Promise<void> {
    await zohoPost(`/api/v1/salesorders/${encodeURIComponent(soId)}/status/confirmed`, {});
  }

  /** Existing packages for a sales order — used to avoid creating duplicates. */
  async listPackagesForSalesOrder(soId: string): Promise<ZohoPackage[]> {
    const res = await zohoGet<ZohoListResponse<ZohoPackage> & { packages?: ZohoPackage[] }>(
      '/api/v1/packages',
      { salesorder_id: soId }
    );
    return res.packages ?? [];
  }

  /** `salesorder_id` is a required query param for package create. */
  async createPackage(salesOrderId: string, payload: CreatePackagePayload): Promise<ZohoPackage> {
    const res = await zohoPost<{ package?: ZohoPackage | ZohoPackage[] }>(
      '/api/v1/packages',
      payload,
      { salesorder_id: salesOrderId }
    );
    const pkg = Array.isArray(res.package) ? res.package[0] : res.package;
    if (!pkg) throw new Error('Zoho package create returned no package');
    return pkg;
  }

  /** `salesorder_id` + `package_ids` are required query params for shipment create. */
  async createShipmentOrder(
    salesOrderId: string,
    packageIds: string[],
    payload: CreateShipmentOrderPayload
  ): Promise<ZohoShipmentOrder> {
    const res = await zohoPost<{ shipment_order?: ZohoShipmentOrder; shipmentorder?: ZohoShipmentOrder }>(
      '/api/v1/shipmentorders',
      payload,
      { salesorder_id: salesOrderId, package_ids: packageIds.join(',') }
    );
    const shipment = res.shipment_order ?? res.shipmentorder;
    if (!shipment) throw new Error('Zoho shipment order create returned no shipmentorder');
    return shipment;
  }

  async markShipmentDelivered(shipmentId: string): Promise<void> {
    await zohoPost(`/api/v1/shipmentorders/${encodeURIComponent(shipmentId)}/status/delivered`, {});
  }

  async createItemAdjustment(payload: CreateAdjustmentPayload): Promise<ZohoItemAdjustment> {
    const res = await zohoPost<{ inventory_adjustment?: ZohoItemAdjustment; item_adjustment?: ZohoItemAdjustment }>(
      '/api/v1/itemadjustments',
      payload
    );
    return res.inventory_adjustment || res.item_adjustment || {};
  }

  async findInvoiceByReference(referenceNumber: string): Promise<ZohoInvoice | null> {
    const res = await zohoGet<ZohoListResponse<ZohoInvoice> & { invoices?: ZohoInvoice[] }>(
      '/api/v1/invoices',
      { reference_number: referenceNumber }
    );
    return res.invoices?.[0] ?? null;
  }

  async createInvoice(payload: CreateInvoicePayload): Promise<ZohoInvoice> {
    const res = await zohoPost<{ invoice?: ZohoInvoice }>('/api/v1/invoices', payload);
    if (!res.invoice) throw new Error('Zoho invoice create returned no invoice');
    return res.invoice;
  }

  /** Move a draft invoice to `sent` (opens it as a receivable / accounting record). */
  async markInvoiceSent(invoiceId: string): Promise<void> {
    await zohoPost(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/status/sent`, {});
  }

  /** Record a customer payment against one or more invoices (closes the receivable). */
  async recordPayment(payload: CreatePaymentPayload): Promise<{ payment_id?: string }> {
    const res = await zohoPost<{ payment?: { payment_id?: string } }>(
      '/api/v1/customerpayments',
      payload
    );
    return res.payment ?? {};
  }

  async deleteItem(itemId: string): Promise<void> {
    await zohoDelete(`/api/v1/items/${encodeURIComponent(itemId)}`);
  }
}

export const zohoClient = new ZohoInventoryClient();
