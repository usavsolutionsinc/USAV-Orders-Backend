import { db } from '@/lib/drizzle/db';
import { customers } from '@/lib/drizzle/schema';
import { eq } from 'drizzle-orm';

export interface UpsertCustomerInput {
  zohoContactId?: string | null;
  orderId?: string | null;
  contactType?: string | null;
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  customerName?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  billingAddress?: Record<string, unknown>;
  shippingAddress?: Record<string, unknown>;
  shippingAddress1?: string | null;
  shippingAddress2?: string | null;
  shippingCity?: string | null;
  shippingState?: string | null;
  shippingPostalCode?: string | null;
  shippingCountry?: string | null;
  status?: string | null;
  customFields?: Record<string, unknown>;
  channelRefs?: Record<string, unknown>;
  zohoLastModified?: Date | null;
  syncedAt?: Date | null;
}

export interface CustomerRepository {
  findById(id: number): Promise<typeof customers.$inferSelect | null>;
  findByEmail(email: string): Promise<typeof customers.$inferSelect | null>;
  upsert(input: UpsertCustomerInput): Promise<typeof customers.$inferSelect>;
}

export class DrizzleCustomerRepository implements CustomerRepository {
  async findById(id: number) {
    const rows = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findByEmail(email: string) {
    const rows = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
    return rows[0] ?? null;
  }

  async upsert(input: UpsertCustomerInput) {
    const match = input.zohoContactId
      ? await db.select().from(customers).where(eq(customers.zohoContactId, input.zohoContactId)).limit(1)
      : input.email
        ? await db.select().from(customers).where(eq(customers.email, input.email)).limit(1)
        : input.orderId
          ? await db.select().from(customers).where(eq(customers.orderId, input.orderId)).limit(1)
          : [];

    const existing = match[0] ?? null;
    const values = {
      zohoContactId: input.zohoContactId ?? null,
      orderId: input.orderId ?? null,
      contactType: input.contactType ?? 'customer',
      displayName: input.displayName,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      customerName: input.customerName ?? input.displayName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      mobile: input.mobile ?? null,
      billingAddress: input.billingAddress ?? {},
      shippingAddress: input.shippingAddress ?? {},
      shippingAddress1: input.shippingAddress1 ?? null,
      shippingAddress2: input.shippingAddress2 ?? null,
      shippingCity: input.shippingCity ?? null,
      shippingState: input.shippingState ?? null,
      shippingPostalCode: input.shippingPostalCode ?? null,
      shippingCountry: input.shippingCountry ?? null,
      status: input.status ?? 'active',
      customFields: input.customFields ?? {},
      channelRefs: input.channelRefs ?? {},
      zohoLastModified: input.zohoLastModified ?? null,
      syncedAt: input.syncedAt ?? null,
      updatedAt: new Date(),
    };

    if (existing) {
      const updated = await db.update(customers).set(values).where(eq(customers.id, existing.id)).returning();
      return updated[0];
    }

    const inserted = await db.insert(customers).values({
      ...values,
      createdAt: new Date(),
    }).returning();
    return inserted[0];
  }
}

export const customerRepository = new DrizzleCustomerRepository();
