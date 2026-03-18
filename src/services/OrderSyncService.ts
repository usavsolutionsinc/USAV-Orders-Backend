import { customerRepository } from '@/lib/repositories/customerRepository';
import { itemRepository } from '@/lib/repositories/itemRepository';
import { salesOrderRepository } from '@/lib/repositories/salesOrderRepository';
import { zohoClient } from '@/lib/zoho/ZohoInventoryClient';
import type { ZohoContact, ZohoSalesOrder } from '@/lib/zoho/types';

export interface ChannelBuyer {
  name: string;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  billingAddress?: Record<string, unknown>;
  shippingAddress?: Record<string, unknown>;
}

export interface ChannelOrderItem {
  sku: string;
  quantity: number;
  rate?: number | null;
  taxId?: string | null;
  taxPercentage?: number | null;
  total?: number | null;
}

export interface ChannelOrder {
  channel: string;
  channelOrderId: string;
  orderDate: string | Date;
  shipmentDate?: string | Date | null;
  shippingCharge?: number | null;
  notes?: string | null;
  buyer: ChannelBuyer;
  items: ChannelOrderItem[];
  billingAddress?: Record<string, unknown>;
  shippingAddress?: Record<string, unknown>;
  currencyCode?: string | null;
}

interface ResolvedLineItem {
  itemId: string;
  zohoItemId: string;
  sku: string;
  name: string;
  quantity: number;
  rate: number;
  taxId?: string | null;
  taxPercentage?: number | null;
  total?: number | null;
}

function toIsoDate(input: string | Date | null | undefined): string {
  if (!input) return new Date().toISOString().slice(0, 10);
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  const raw = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid order date: ${raw}`);
  }
  return parsed.toISOString().slice(0, 10);
}

function toNumericString(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : null;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeAddress(address: Record<string, unknown> | null | undefined) {
  return address && typeof address === 'object' ? address : {};
}

export class OrderSyncService {
  async ingestExternalOrder(rawOrder: ChannelOrder) {
    const referenceNumber = String(rawOrder.channelOrderId || '').trim();
    if (!referenceNumber) {
      throw new Error('channelOrderId is required');
    }

    const existing = await salesOrderRepository.findByReference(referenceNumber);
    if (existing) return existing;

    const existingZoho = await zohoClient.findSalesOrderByReference(referenceNumber);
    if (existingZoho) {
      return salesOrderRepository.create(this.mapZohoSalesOrderToLocal(rawOrder, existingZoho, null));
    }

    try {
      const contact = await this.findOrCreateContact(rawOrder);
      const lineItems = await this.resolveLineItems(rawOrder.items);

      const zohoSO = await zohoClient.createSalesOrder({
        customer_id: contact.zohoContactId!,
        reference_number: referenceNumber,
        salesorder_date: toIsoDate(rawOrder.orderDate),
        shipment_date: rawOrder.shipmentDate ? toIsoDate(rawOrder.shipmentDate) : undefined,
        line_items: lineItems.map((item) => ({
          item_id: item.zohoItemId,
          quantity: item.quantity,
          rate: item.rate,
        })),
        shipping_charge: rawOrder.shippingCharge ?? 0,
        notes: rawOrder.notes ?? `${rawOrder.channel} order ${referenceNumber}`,
      });

      await zohoClient.confirmSalesOrder(zohoSO.salesorder_id);

      return salesOrderRepository.create({
        zohoSoId: zohoSO.salesorder_id,
        salesorderNumber: zohoSO.salesorder_number ?? null,
        referenceNumber,
        channel: rawOrder.channel,
        contactId: contact.id,
        status: String(zohoSO.status || 'confirmed').toLowerCase(),
        orderDate: toIsoDate(rawOrder.orderDate),
        shipmentDate: rawOrder.shipmentDate ? toIsoDate(rawOrder.shipmentDate) : null,
        subTotal: toNumericString(zohoSO.sub_total),
        taxTotal: toNumericString(zohoSO.tax_total),
        total: toNumericString(zohoSO.total),
        currencyCode: rawOrder.currencyCode ?? zohoSO.currency_code ?? 'USD',
        shippingCharge: toNumericString(rawOrder.shippingCharge ?? zohoSO.shipping_charge),
        notes: rawOrder.notes ?? null,
        lineItems: lineItems.map((item) => ({
          item_id: item.itemId,
          zoho_item_id: item.zohoItemId,
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          rate: item.rate,
          tax_id: item.taxId ?? null,
          tax_percentage: item.taxPercentage ?? null,
          total: item.total ?? null,
        })),
        billingAddress: normalizeAddress(rawOrder.billingAddress ?? rawOrder.buyer.billingAddress),
        shippingAddress: normalizeAddress(rawOrder.shippingAddress ?? rawOrder.buyer.shippingAddress),
        zohoLastModified: toDate(zohoSO.last_modified_time),
        syncedAt: new Date(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Zoho sales order ingestion error';
      const current = await salesOrderRepository.findByReference(referenceNumber);
      if (!current) {
        await salesOrderRepository.create({
          referenceNumber,
          channel: rawOrder.channel,
          status: 'zoho_error',
          orderDate: toIsoDate(rawOrder.orderDate),
          shipmentDate: rawOrder.shipmentDate ? toIsoDate(rawOrder.shipmentDate) : null,
          shippingCharge: toNumericString(rawOrder.shippingCharge),
          notes: rawOrder.notes ?? null,
          lineItems: rawOrder.items,
          billingAddress: normalizeAddress(rawOrder.billingAddress ?? rawOrder.buyer.billingAddress),
          shippingAddress: normalizeAddress(rawOrder.shippingAddress ?? rawOrder.buyer.shippingAddress),
          internalNotes: message,
        });
      }
      await salesOrderRepository.markZohoError(referenceNumber, message);
      throw error;
    }
  }

  private async findOrCreateContact(rawOrder: ChannelOrder) {
    const email = rawOrder.buyer.email?.trim().toLowerCase() || null;
    const existingLocal = email ? await customerRepository.findByEmail(email) : null;
    if (existingLocal?.zohoContactId) {
      return existingLocal;
    }

    const existingZoho = email ? await zohoClient.findContactByEmail(email) : null;
    if (existingZoho) {
      return customerRepository.upsert(this.mapZohoContactToCustomer(rawOrder, existingZoho));
    }

    const createdZoho = await zohoClient.createContact({
      display_name: rawOrder.buyer.name,
      email: email ?? undefined,
      phone: rawOrder.buyer.phone ?? undefined,
      mobile: rawOrder.buyer.mobile ?? undefined,
      contact_type: 'customer',
      billing_address: normalizeAddress(rawOrder.billingAddress ?? rawOrder.buyer.billingAddress),
      shipping_address: normalizeAddress(rawOrder.shippingAddress ?? rawOrder.buyer.shippingAddress),
    });

    return customerRepository.upsert(this.mapZohoContactToCustomer(rawOrder, createdZoho));
  }

  private async resolveLineItems(items: ChannelOrderItem[]): Promise<ResolvedLineItem[]> {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Order has no line items');
    }

    const resolved = await Promise.all(items.map(async (line) => {
      const sku = String(line.sku || '').trim();
      if (!sku) {
        throw new Error('Line item sku is required');
      }

      const localItem = await itemRepository.findBySku(sku);
      if (!localItem?.zohoItemId) {
        throw new Error(`Missing Zoho item mapping for SKU ${sku}`);
      }

      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`Invalid quantity for SKU ${sku}`);
      }

      const rate = Number(line.rate ?? localItem.rate ?? 0);
      return {
        itemId: localItem.id,
        zohoItemId: localItem.zohoItemId,
        sku,
        name: localItem.name,
        quantity,
        rate: Number.isFinite(rate) ? rate : 0,
        taxId: line.taxId ?? null,
        taxPercentage: line.taxPercentage ?? null,
        total: line.total ?? null,
      };
    }));

    return resolved;
  }

  private mapZohoContactToCustomer(rawOrder: ChannelOrder, contact: ZohoContact) {
    const shippingAddress = normalizeAddress(rawOrder.shippingAddress ?? rawOrder.buyer.shippingAddress);
    return {
      zohoContactId: contact.contact_id,
      orderId: rawOrder.channelOrderId,
      contactType: contact.contact_type ?? 'customer',
      displayName: rawOrder.buyer.name || contact.contact_name || contact.company_name || 'Customer',
      firstName: rawOrder.buyer.firstName ?? contact.first_name ?? null,
      lastName: rawOrder.buyer.lastName ?? contact.last_name ?? null,
      customerName: rawOrder.buyer.name || contact.contact_name || 'Customer',
      email: rawOrder.buyer.email?.trim().toLowerCase() ?? contact.email ?? null,
      phone: rawOrder.buyer.phone ?? contact.phone ?? null,
      mobile: rawOrder.buyer.mobile ?? contact.mobile ?? null,
      billingAddress: normalizeAddress(rawOrder.billingAddress ?? rawOrder.buyer.billingAddress ?? contact.billing_address as Record<string, unknown> | undefined),
      shippingAddress,
      shippingAddress1: typeof shippingAddress.address === 'string' ? shippingAddress.address : null,
      shippingAddress2: typeof shippingAddress.street2 === 'string' ? shippingAddress.street2 : null,
      shippingCity: typeof shippingAddress.city === 'string' ? shippingAddress.city : null,
      shippingState: typeof shippingAddress.state === 'string' ? shippingAddress.state : null,
      shippingPostalCode: typeof shippingAddress.zip === 'string' ? shippingAddress.zip : null,
      shippingCountry: typeof shippingAddress.country === 'string' ? shippingAddress.country : null,
      status: contact.status ? String(contact.status).toLowerCase() : 'active',
      customFields: Array.isArray(contact.custom_fields) ? { values: contact.custom_fields } : {},
      channelRefs: { [rawOrder.channel]: rawOrder.channelOrderId },
      zohoLastModified: toDate(contact.last_modified_time),
      syncedAt: new Date(),
    };
  }

  private mapZohoSalesOrderToLocal(rawOrder: ChannelOrder, salesOrder: ZohoSalesOrder, contactId: number | null) {
    return {
      zohoSoId: salesOrder.salesorder_id,
      salesorderNumber: salesOrder.salesorder_number ?? null,
      referenceNumber: rawOrder.channelOrderId,
      channel: rawOrder.channel,
      contactId,
      status: String(salesOrder.status || 'confirmed').toLowerCase(),
      orderDate: toIsoDate(rawOrder.orderDate),
      shipmentDate: rawOrder.shipmentDate ? toIsoDate(rawOrder.shipmentDate) : null,
      subTotal: toNumericString(salesOrder.sub_total),
      taxTotal: toNumericString(salesOrder.tax_total),
      total: toNumericString(salesOrder.total),
      currencyCode: rawOrder.currencyCode ?? salesOrder.currency_code ?? 'USD',
      shippingCharge: toNumericString(rawOrder.shippingCharge ?? salesOrder.shipping_charge),
      notes: rawOrder.notes ?? null,
      lineItems: Array.isArray(salesOrder.line_items) ? salesOrder.line_items : rawOrder.items,
      billingAddress: normalizeAddress(rawOrder.billingAddress ?? rawOrder.buyer.billingAddress),
      shippingAddress: normalizeAddress(rawOrder.shippingAddress ?? rawOrder.buyer.shippingAddress),
      zohoLastModified: toDate(salesOrder.last_modified_time),
      syncedAt: new Date(),
    };
  }
}

export const orderSyncService = new OrderSyncService();
