import { paginateZohoList, zohoDelete, zohoGet, zohoPost, zohoPut } from '@/lib/zoho/httpClient';
import type {
  CreateAdjustmentPayload,
  CreateContactPayload,
  CreateInvoicePayload,
  CreatePackagePayload,
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

  async confirmSalesOrder(soId: string): Promise<void> {
    await zohoPost(`/api/v1/salesorders/${encodeURIComponent(soId)}/status/confirmed`, {});
  }

  async createPackage(payload: CreatePackagePayload): Promise<ZohoPackage> {
    const res = await zohoPost<{ package?: ZohoPackage }>('/api/v1/packages', payload);
    if (!res.package) throw new Error('Zoho package create returned no package');
    return res.package;
  }

  async createShipmentOrder(payload: CreateShipmentOrderPayload): Promise<ZohoShipmentOrder> {
    const res = await zohoPost<{ shipmentorder?: ZohoShipmentOrder }>('/api/v1/shipmentorders', payload);
    if (!res.shipmentorder) throw new Error('Zoho shipment order create returned no shipmentorder');
    return res.shipmentorder;
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

  async createInvoice(payload: CreateInvoicePayload): Promise<ZohoInvoice> {
    const res = await zohoPost<{ invoice?: ZohoInvoice }>('/api/v1/invoices', payload);
    if (!res.invoice) throw new Error('Zoho invoice create returned no invoice');
    return res.invoice;
  }

  async deleteItem(itemId: string): Promise<void> {
    await zohoDelete(`/api/v1/items/${encodeURIComponent(itemId)}`);
  }
}

export const zohoClient = new ZohoInventoryClient();
