// Company billing (spec 4.9). Money is whole paise; credits are negative.
import { z } from 'zod';

export const createInvoiceSchema = z
  .object({
    companyId: z.int(),
    orderIds: z.array(z.int()).default([]),
    adjustmentIds: z.array(z.int()).default([]),
  })
  .refine((v) => v.orderIds.length + v.adjustmentIds.length > 0, {
    message: 'Pick at least one order or credit',
    path: ['orderIds'],
  });
export type CreateInvoiceInput = z.input<typeof createInvoiceSchema>;

// A credit for a delivered order that turned out short (D7).
export const creditSchema = z.object({
  amount: z.int().min(1, 'Must be above zero'), // paise to credit back
  reason: z.string().trim().min(3, 'Say why'),
});
export type CreditInput = z.infer<typeof creditSchema>;

export type BillingCompany = {
  id: number;
  name: string;
  unbilledOrders: number;
  unbilledAmount: number; // orders + credits not on an invoice yet
  unpaidInvoices: number;
  unpaidAmount: number;
};

export type UnbilledOrder = {
  id: number;
  deliveryDate: string;
  employee: string;
  status: 'CONFIRMED' | 'DELIVERED';
  total: number;
};
export type UnbilledCredit = { id: number; orderId: number; amount: number; reason: string };

export type InvoiceSummary = {
  id: number;
  createdAt: string;
  paidAt: string | null;
  total: number;
  orderCount: number;
};

export type CompanyBilling = {
  company: { id: number; name: string; billingName: string; billingEmail: string };
  unbilledOrders: UnbilledOrder[];
  unbilledCredits: UnbilledCredit[];
  invoices: InvoiceSummary[];
};

export type InvoiceDetail = InvoiceSummary & {
  company: { id: number; name: string; billingName: string; billingEmail: string; billingPhone: string | null };
  orders: UnbilledOrder[];
  credits: UnbilledCredit[];
};
