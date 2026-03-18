import { db } from '@/lib/drizzle/db';
import { entityNotes, salesOrders } from '@/lib/drizzle/schema';
import { eq } from 'drizzle-orm';

export interface InsertSalesOrder {
  zohoSoId?: string | null;
  salesorderNumber?: string | null;
  referenceNumber: string;
  channel: string;
  contactId?: number | null;
  status: string;
  returnStatus?: string | null;
  orderDate: string;
  shipmentDate?: string | null;
  subTotal?: string | null;
  taxTotal?: string | null;
  total?: string | null;
  currencyCode?: string | null;
  shippingCharge?: string | null;
  notes?: string | null;
  lineItems: unknown[];
  billingAddress?: Record<string, unknown>;
  shippingAddress?: Record<string, unknown>;
  zohoLastModified?: Date | null;
  syncedAt?: Date | null;
  internalNotes?: string | null;
  assignedTo?: number | null;
}

export interface SalesOrderRepository {
  findByReference(referenceNumber: string): Promise<typeof salesOrders.$inferSelect | null>;
  create(input: InsertSalesOrder): Promise<typeof salesOrders.$inferSelect>;
  markZohoError(referenceNumber: string, errorMessage: string): Promise<void>;
}

export class DrizzleSalesOrderRepository implements SalesOrderRepository {
  async findByReference(referenceNumber: string) {
    const rows = await db.select().from(salesOrders).where(eq(salesOrders.referenceNumber, referenceNumber)).limit(1);
    return rows[0] ?? null;
  }

  async create(input: InsertSalesOrder) {
    const rows = await db.insert(salesOrders).values({
      zohoSoId: input.zohoSoId ?? null,
      salesorderNumber: input.salesorderNumber ?? null,
      referenceNumber: input.referenceNumber,
      channel: input.channel,
      contactId: input.contactId ?? null,
      status: input.status,
      returnStatus: input.returnStatus ?? 'none',
      orderDate: input.orderDate,
      shipmentDate: input.shipmentDate ?? null,
      subTotal: input.subTotal ?? null,
      taxTotal: input.taxTotal ?? null,
      total: input.total ?? null,
      currencyCode: input.currencyCode ?? 'USD',
      shippingCharge: input.shippingCharge ?? null,
      notes: input.notes ?? null,
      lineItems: input.lineItems,
      billingAddress: input.billingAddress ?? {},
      shippingAddress: input.shippingAddress ?? {},
      zohoLastModified: input.zohoLastModified ?? null,
      syncedAt: input.syncedAt ?? null,
      internalNotes: input.internalNotes ?? null,
      assignedTo: input.assignedTo ?? null,
    }).returning();
    return rows[0];
  }

  async markZohoError(referenceNumber: string, errorMessage: string) {
    const existing = await this.findByReference(referenceNumber);
    if (!existing) return;

    await db.update(salesOrders)
      .set({ status: 'zoho_error', updatedAt: new Date() })
      .where(eq(salesOrders.id, existing.id));

    await db.insert(entityNotes).values({
      entityType: 'sales_order',
      entityId: existing.id,
      body: errorMessage,
      createdAt: new Date(),
    });
  }
}

export const salesOrderRepository = new DrizzleSalesOrderRepository();
