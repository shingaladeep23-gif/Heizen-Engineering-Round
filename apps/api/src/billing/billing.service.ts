import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  formatMoney,
  type BillingCompany,
  type CompanyBilling,
  type CreditInput,
  type InvoiceDetail,
  type UnbilledOrder,
} from '@fernleaf/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { dayOf } from '../orders/calendar.js';
import { BILLABLE, creditLeft, invoiceTotal } from './billing-rules.js';

const uninvoicedOrders = (companyId?: number): Prisma.OrderWhereInput => ({
  companyId,
  invoiceId: null,
  status: { in: [...BILLABLE] },
});

// A credit only means something if its order was charged: it's either on an
// invoice already or still billable. A credit on an order that was then
// cancelled before invoicing is simply dropped.
const uninvoicedCredits = (companyId?: number): Prisma.AdjustmentWhereInput => ({
  invoiceId: null,
  order: {
    companyId,
    OR: [{ invoiceId: { not: null } }, { status: { in: [...BILLABLE] } }],
  },
});

const toUnbilledOrder = (o: {
  id: number;
  deliveryDate: Date;
  status: string;
  total: number;
  employee: { name: string };
}): UnbilledOrder => ({
  id: o.id,
  deliveryDate: dayOf(o.deliveryDate),
  employee: o.employee.name,
  status: o.status as UnbilledOrder['status'],
  total: o.total,
});

@Injectable()
export class BillingService {
  constructor(private readonly db: PrismaService) {}

  async companies(): Promise<BillingCompany[]> {
    const [companies, orders, credits, unpaid] = await Promise.all([
      this.db.company.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.db.order.groupBy({
        by: ['companyId'],
        where: uninvoicedOrders(),
        _count: true,
        _sum: { total: true },
      }),
      this.db.adjustment.findMany({
        where: uninvoicedCredits(),
        include: { order: { select: { companyId: true } } },
      }),
      this.db.invoice.groupBy({
        by: ['companyId'],
        where: { paidAt: null },
        _count: true,
        _sum: { total: true },
      }),
    ]);
    return companies.map((company) => {
      const o = orders.find((row) => row.companyId === company.id);
      const i = unpaid.find((row) => row.companyId === company.id);
      const credit = credits
        .filter((c) => c.order.companyId === company.id)
        .reduce((sum, c) => sum + c.amount, 0);
      return {
        ...company,
        unbilledOrders: o?._count ?? 0,
        unbilledAmount: (o?._sum.total ?? 0) + credit,
        unpaidInvoices: i?._count ?? 0,
        unpaidAmount: i?._sum.total ?? 0,
      };
    });
  }

  async company(id: number): Promise<CompanyBilling> {
    const company = await this.db.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException({ message: 'Company not found' });
    const [orders, credits, invoices] = await Promise.all([
      this.db.order.findMany({
        where: uninvoicedOrders(id),
        orderBy: [{ deliveryDate: 'asc' }, { id: 'asc' }],
        include: { employee: { select: { name: true } } },
      }),
      this.db.adjustment.findMany({ where: uninvoicedCredits(id), orderBy: { id: 'asc' } }),
      this.db.invoice.findMany({
        where: { companyId: id },
        orderBy: { id: 'desc' },
        include: { _count: { select: { orders: true } } },
      }),
    ]);
    return {
      company: {
        id: company.id,
        name: company.name,
        billingName: company.billingName,
        billingEmail: company.billingEmail,
      },
      unbilledOrders: orders.map(toUnbilledOrder),
      unbilledCredits: credits.map(({ id, orderId, amount, reason }) => ({
        id,
        orderId,
        amount,
        reason,
      })),
      invoices: invoices.map((inv) => ({
        id: inv.id,
        createdAt: inv.createdAt.toISOString(),
        paidAt: inv.paidAt?.toISOString() ?? null,
        total: inv.total,
        orderCount: inv._count.orders,
      })),
    };
  }

  /**
   * Groups orders and credits into a new invoice. Each order is claimed with
   * "set invoiceId where invoiceId is null": if someone else invoiced it in
   * the meantime, Postgres makes us wait for them, the row no longer matches,
   * and the whole invoice is rolled back. So an order can never end up on
   * two invoices.
   */
  async createInvoice(companyId: number, orderIds: number[], adjustmentIds: number[]) {
    return this.db.$transaction(async (tx) => {
      const [orders, credits] = await Promise.all([
        tx.order.findMany({ where: { ...uninvoicedOrders(companyId), id: { in: orderIds } } }),
        tx.adjustment.findMany({
          where: { ...uninvoicedCredits(companyId), id: { in: adjustmentIds } },
        }),
      ]);
      if (orders.length !== orderIds.length || credits.length !== adjustmentIds.length) {
        throw new ConflictException({
          message:
            'Some of those were already invoiced or are no longer billable. Refresh and try again.',
        });
      }
      const total = invoiceTotal(orders, credits);
      // Totals are whole paise in a 32-bit column (up to about ₹2.1 crore).
      if (Math.abs(total) > 2_000_000_000) {
        throw new BadRequestException({
          message: 'That is too much for one invoice. Split it into two or more.',
        });
      }
      const invoice = await tx.invoice.create({ data: { companyId, total } });
      // Re-checked here, not just above: an order cancelled while we were
      // reading must not end up on the invoice.
      const claimed = await tx.order.updateMany({
        where: { id: { in: orderIds }, invoiceId: null, status: { in: [...BILLABLE] } },
        data: { invoiceId: invoice.id },
      });
      const claimedCredits = await tx.adjustment.updateMany({
        where: { id: { in: adjustmentIds }, invoiceId: null },
        data: { invoiceId: invoice.id },
      });
      if (claimed.count !== orderIds.length || claimedCredits.count !== adjustmentIds.length) {
        throw new ConflictException({
          message: 'Someone else just invoiced some of these. Refresh and try again.',
        });
      }
      return invoice;
    });
  }

  async markPaid(id: number) {
    const { count } = await this.db.invoice.updateMany({
      where: { id, paidAt: null },
      data: { paidAt: new Date() },
    });
    if (count === 0)
      throw new ConflictException({ message: 'That invoice is already paid, or doesn’t exist' });
  }

  async invoice(id: number): Promise<InvoiceDetail> {
    const invoice = await this.db.invoice.findUnique({
      where: { id },
      include: {
        company: true,
        orders: {
          orderBy: [{ deliveryDate: 'asc' }, { id: 'asc' }],
          include: { employee: { select: { name: true } } },
        },
        adjustments: { orderBy: { id: 'asc' } },
      },
    });
    if (!invoice) throw new NotFoundException({ message: 'Invoice not found' });
    const { company } = invoice;
    return {
      id: invoice.id,
      createdAt: invoice.createdAt.toISOString(),
      paidAt: invoice.paidAt?.toISOString() ?? null,
      total: invoice.total,
      orderCount: invoice.orders.length,
      company: {
        id: company.id,
        name: company.name,
        billingName: company.billingName,
        billingEmail: company.billingEmail,
        billingPhone: company.billingPhone,
      },
      orders: invoice.orders.map(toUnbilledOrder),
      credits: invoice.adjustments.map(({ id, orderId, amount, reason }) => ({
        id,
        orderId,
        amount,
        reason,
      })),
    };
  }

  /** A credit for a delivered order that turned out short. */
  async credit(orderId: number, { amount, reason }: CreditInput) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { adjustments: true },
      });
      if (!order) throw new NotFoundException({ message: 'Order not found' });
      // A shortage only shows up once the order has arrived.
      if (order.status !== 'DELIVERED') {
        throw new ConflictException({
          message: 'Only delivered orders can be credited for a short delivery',
        });
      }
      const left = creditLeft(order.total, order.adjustments);
      if (amount > left) {
        throw new BadRequestException({
          message: `At most ${formatMoney(left)} can still be credited on this order`,
          fieldErrors: { amount: 'More than what is left on this order' },
        });
      }
      return tx.adjustment.create({ data: { orderId, amount: -amount, reason } });
    });
  }
}
