import { Injectable } from '@nestjs/common';
import type { AdminDashboard } from '@fernleaf/shared';
import { BillingService } from '../billing/billing.service.js';
import { BILLABLE } from '../billing/billing-rules.js';
import { DispatchService } from '../dispatch/dispatch.service.js';
import { addDays, todayIST } from '../orders/calendar.js';
import { OrdersService } from '../orders/orders.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PrismaService } from '../prisma.service.js';

const DAY_MS = 86_400_000;
const PAYMENT_TERMS_DAYS = 14;

/**
 * Figures for the admin dashboard. Each one reuses the same rule as the
 * screen it summarises (billing, dispatch, pricing), so the dashboard can't
 * disagree with them. Dates are delivery dates in IST.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: PrismaService,
    private readonly orders: OrdersService,
    private readonly dispatch: DispatchService,
    private readonly billing: BillingService,
    private readonly pricing: PricingService,
  ) {}

  async admin(now = new Date()): Promise<AdminDashboard> {
    await this.orders.processDueCutoffsSoon();
    const today = todayIST(now);
    const date = (day: string) => new Date(day);
    const billable = { in: [...BILLABLE] };
    const weekFrom = addDays(today, -7);
    const weekTo = addDays(today, -1);

    const weekDates = { gte: date(weekFrom), lte: date(weekTo) };
    const [todayOrders, drops, upcoming, companies, unpaid, paid, lastWeek, credits, lines, tiers] =
      await Promise.all([
        this.db.order.findMany({ where: { deliveryDate: date(today), status: billable } }),
        this.dispatch.drops(today),
        this.db.order.groupBy({
          by: ['status'],
          where: { deliveryDate: { gte: date(addDays(today, 1)), lte: date(addDays(today, 7)) } },
          _count: true,
          _sum: { total: true },
        }),
        this.billing.companies(),
        this.db.invoice.findMany({ where: { paidAt: null } }),
        this.db.invoice.aggregate({
          where: { paidAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } },
          _sum: { total: true },
        }),
        this.db.order.findMany({
          where: { deliveryDate: weekDates },
          select: { status: true, total: true, deliveredOnTime: true },
        }),
        // Short-delivery credits on those orders come off their revenue.
        this.db.adjustment.aggregate({
          where: { order: { deliveryDate: weekDates, status: billable } },
          _sum: { amount: true },
        }),
        // By dish, not by the name on the order line, so a renamed dish still counts once.
        this.db.orderLine.groupBy({
          by: ['dishId'],
          where: { order: { deliveryDate: weekDates, status: billable } },
          _sum: { quantity: true },
          orderBy: { _sum: { quantity: 'desc' } },
          take: 5,
        }),
        this.pricing.tiers(),
      ]);
    const dishNames = new Map(
      (
        await this.db.dish.findMany({
          where: { id: { in: lines.map((l) => l.dishId) } },
          select: { id: true, name: true },
        })
      ).map((d) => [d.id, d.name]),
    );

    const byStatus = (status: string) => upcoming.find((g) => g.status === status);
    const sum = (rows: { total: number }[]) => rows.reduce((s, r) => s + r.total, 0);
    const week = lastWeek.filter((o) => BILLABLE.includes(o.status as (typeof BILLABLE)[number]));
    const overdueBefore = now.getTime() - PAYMENT_TERMS_DAYS * DAY_MS;

    return {
      today: {
        date: today,
        orders: todayOrders.length,
        value: sum(todayOrders),
        delivered: todayOrders.filter((o) => o.status === 'DELIVERED').length,
        lateDrops: drops.filter((d) => d.late).length,
      },
      upcoming: {
        confirmed: byStatus('CONFIRMED')?._count ?? 0,
        placed: byStatus('PLACED')?._count ?? 0,
        drafts: byStatus('DRAFT')?._count ?? 0,
        value: (byStatus('CONFIRMED')?._sum.total ?? 0) + (byStatus('PLACED')?._sum.total ?? 0),
      },
      money: {
        unbilled: companies.reduce((s, c) => s + c.unbilledAmount, 0),
        unpaid: sum(unpaid),
        unpaidInvoices: unpaid.length,
        overdueInvoices: unpaid.filter((i) => i.createdAt.getTime() < overdueBefore).length,
        paidLast30Days: paid._sum.total ?? 0,
      },
      lastWeek: {
        from: weekFrom,
        to: weekTo,
        orders: week.length,
        revenue: sum(week) + (credits._sum.amount ?? 0),
        delivered: week.filter((o) => o.status === 'DELIVERED').length,
        onTime: week.filter((o) => o.deliveredOnTime === true).length,
        cancelled: lastWeek.filter((o) => o.status === 'CANCELLED').length,
        rejected: lastWeek.filter((o) => o.status === 'REJECTED').length,
      },
      topDishes: lines.map((l) => ({
        name: dishNames.get(l.dishId) ?? '',
        portions: l._sum.quantity ?? 0,
      })),
      // The same count as the Price tiers page.
      tiersMissingPrices: tiers
        .filter((t) => t.missingDishes > 0)
        .map((t) => ({ name: t.name, missing: t.missingDishes })),
    };
  }
}
