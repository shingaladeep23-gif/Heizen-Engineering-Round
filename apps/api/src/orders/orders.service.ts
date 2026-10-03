import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  can,
  type DeliveryInfo,
  type DeliveryOverride,
  type OrderDetail,
  type OrderPage,
  type OrderStatus,
} from '@fernleaf/shared';
import { Prisma, type User } from '@prisma/client';
import type { z } from 'zod';
import type { orderSchema } from '@fernleaf/shared';
import { MenuService } from '../menu/menu.service.js';
import { PrismaService } from '../prisma.service.js';
import {
  cutoffFor,
  dayOf,
  isOpen,
  plannedTimes,
  todayIST,
  type Calendar,
  type Day,
} from './calendar.js';
import { buildLines, RuleError } from './order-rules.js';

type OrderBody = z.output<typeof orderSchema>;
export type OrderQuery = {
  q?: string;
  from?: Day;
  to?: Day;
  status?: OrderStatus;
  companyId?: number;
  invoiced?: boolean;
  page: number;
};

const PAGE_SIZE = 20;
const OPEN: OrderStatus[] = ['DRAFT', 'PLACED']; // still editable before the cut-off

const bad = (field: string, message: string) =>
  new BadRequestException({ message, fieldErrors: { [field]: message } });

@Injectable()
export class OrdersService {
  private readonly log = new Logger(OrdersService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly menus: MenuService,
  ) {}

  // ---------- Calendar helpers ----------

  private async kitchen() {
    const [settings, holidays] = await Promise.all([
      this.db.settings.findUniqueOrThrow({ where: { id: 1 } }),
      this.db.kitchenHoliday.findMany(),
    ]);
    const calendar: Calendar = {
      workingDays: settings.kitchenWorkingDays,
      holidays: new Set(holidays.map((h) => dayOf(h.date))),
    };
    return { settings, calendar };
  }

  async cutoffOf(day: Day) {
    const { settings, calendar } = await this.kitchen();
    return cutoffFor(day, calendar, settings.cutoffDays, settings.cutoffTime);
  }

  /** Everything the order form needs to know for one employee on one date. */
  async deliveryInfo(employeeId: number, day: Day): Promise<DeliveryInfo> {
    const employee = await this.db.employee.findUnique({
      where: { id: employeeId },
      include: { company: { include: { addresses: true, holidays: true } } },
    });
    if (!employee) throw new NotFoundException({ message: 'Employee not found' });
    const { company } = employee;
    const { settings, calendar } = await this.kitchen();

    const problems: string[] = [];
    if (day < todayIST()) problems.push('That date has already passed');
    const companyCalendar = {
      workingDays: company.workingDays,
      holidays: new Set(company.holidays.map((h) => dayOf(h.date))),
    };
    if (!isOpen(companyCalendar, day)) problems.push(`${company.name} isn't open that day`);
    if (!isOpen(calendar, day)) problems.push("The kitchen isn't cooking that day");

    const cutoffAt = cutoffFor(day, calendar, settings.cutoffDays, settings.cutoffTime);
    return {
      cutoffAt: cutoffAt.toISOString(),
      cutoffPassed: cutoffAt <= new Date(),
      problems,
      defaults: {
        deliveryTime: company.deliveryTime,
        addressId: company.defaultAddressId,
        packagingTypeId: company.packagingTypeId,
      },
      allowed: {
        address: employee.canChooseAddress,
        time: employee.canChangeTime,
        packaging: employee.canChangePackaging,
      },
      addresses: company.addresses.map(({ id, label, text }) => ({ id, label, text })),
    };
  }

  // ---------- Create and edit ----------

  /**
   * Creates (id = null) or edits an order. Every rule in spec 4.6 is checked
   * here, whatever the form did. `input.place` false saves a draft.
   */
  async save(user: User, id: number | null, input: OrderBody) {
    const mayOverride = can(user.role, 'orders.override');
    const info = await this.deliveryInfo(input.employeeId, input.deliveryDate);
    if (info.problems.length) throw bad('deliveryDate', info.problems.join('. '));
    if (info.cutoffPassed && !mayOverride) {
      throw bad('deliveryDate', 'The cut-off for that date has passed');
    }
    if (info.cutoffPassed && !input.place) {
      throw bad(
        'deliveryDate',
        'After the cut-off an order can only be placed, not saved as a draft',
      );
    }

    // Delivery details: the company default unless the employee may change it.
    const deliveryTime = input.deliveryTime ?? info.defaults.deliveryTime;
    const addressId = input.addressId ?? info.defaults.addressId;
    const packagingTypeId = input.packagingTypeId ?? info.defaults.packagingTypeId;
    if (!addressId) throw bad('addressId', 'This company has no delivery address yet');
    if (!info.addresses.some((a) => a.id === addressId)) {
      throw bad('addressId', "That address doesn't belong to this employee's company");
    }
    if (deliveryTime !== info.defaults.deliveryTime && !info.allowed.time) {
      throw bad('deliveryTime', "This employee can't change the delivery time");
    }
    if (addressId !== info.defaults.addressId && !info.allowed.address) {
      throw bad('addressId', "This employee can't choose their own address");
    }
    if (packagingTypeId !== info.defaults.packagingTypeId && !info.allowed.packaging) {
      throw bad('packagingTypeId', "This employee can't change the packaging");
    }

    // Lines are checked against the employee's own menu and priced from it.
    const menu = await this.menus.menuFor(input.employeeId, { all: true });
    const dishes = new Map(menu.categories.flatMap((c) => c.dishes).map((d) => [d.id, d]));
    let built: ReturnType<typeof buildLines>;
    try {
      built = buildLines(dishes, input.lines);
    } catch (error) {
      if (error instanceof RuleError) throw bad(error.field, error.message);
      throw error;
    }

    const now = new Date();
    // Placed after the cut-off (admins only) means it's confirmed straight away.
    const status: OrderStatus = !input.place ? 'DRAFT' : info.cutoffPassed ? 'CONFIRMED' : 'PLACED';
    const employee = await this.db.employee.findUniqueOrThrow({ where: { id: input.employeeId } });
    const data = {
      status,
      deliveryDate: new Date(input.deliveryDate),
      deliveryTime,
      addressId,
      packagingTypeId,
      total: built.total,
      confirmedAt: status === 'CONFIRMED' ? now : null,
      lines: {
        create: built.lines.map(({ combos, ...line }) => ({
          ...line,
          combos: { create: combos.map((combo) => ({ ...combo, choices: combo.choices })) },
        })),
      },
    };

    if (id === null) {
      return this.db.order.create({
        data: {
          ...data,
          employeeId: employee.id,
          companyId: employee.companyId,
          placedAt: status === 'DRAFT' ? null : now,
        },
      });
    }

    return this.db.$transaction(async (tx) => {
      const existing = await this.lock(tx, id);
      if (existing.employeeId !== input.employeeId) {
        throw bad('employeeId', "An order can't be moved to another employee");
      }
      if (!OPEN.includes(existing.status)) {
        throw new ConflictException({
          message: `A ${existing.status.toLowerCase()} order can't be edited`,
        });
      }
      await this.checkBeforeCutoff(existing.deliveryDate, mayOverride);
      await tx.orderLine.deleteMany({ where: { orderId: id } });
      return tx.order.update({
        where: { id },
        data: { ...data, placedAt: existing.placedAt ?? (status === 'DRAFT' ? null : now) },
      });
    });
  }

  // Row lock, so two people editing the same order can't interleave.
  private async lock(tx: Prisma.TransactionClient, id: number) {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException({ message: 'Order not found' });
    return order;
  }

  private async checkBeforeCutoff(deliveryDate: Date, mayOverride: boolean) {
    if (!mayOverride && (await this.cutoffOf(dayOf(deliveryDate))) <= new Date()) {
      throw new ConflictException({
        message: 'The cut-off has passed, so only an admin can change this order',
      });
    }
  }

  // ---------- Status changes ----------

  async cancel(user: User, id: number) {
    const mayOverride = can(user.role, 'orders.override');
    const order = await this.find(id);
    if (OPEN.includes(order.status)) {
      await this.checkBeforeCutoff(order.deliveryDate, mayOverride);
    } else if (order.status !== 'CONFIRMED' || !mayOverride) {
      throw new ConflictException({
        message: `A ${order.status.toLowerCase()} order can't be cancelled`,
      });
    }
    await this.moveStatus(order, 'CANCELLED', { cancelledAt: new Date() });
    await this.creditIfInvoiced(order, 'Cancelled after invoicing');
  }

  // Admins reject an order the kitchen can't fulfil, before cooking starts (D8).
  async reject(id: number, reason: string) {
    const order = await this.find(id);
    if (!['PLACED', 'CONFIRMED'].includes(order.status) || order.kitchenStartedAt) {
      throw new ConflictException({
        message: 'Only placed or confirmed orders the kitchen hasn’t started can be rejected',
      });
    }
    await this.moveStatus(order, 'REJECTED', { rejectedAt: new Date(), rejectReason: reason });
    await this.creditIfInvoiced(order, `Rejected after invoicing: ${reason}`);
  }

  /**
   * Compare-and-set: only moves the order if it's still in the status we read.
   * If someone else changed it in the meantime, nothing happens and we say so.
   */
  private async moveStatus(
    order: { id: number; status: OrderStatus },
    to: OrderStatus,
    data: Prisma.OrderUpdateManyMutationInput,
  ) {
    const { count } = await this.db.order.updateMany({
      where: {
        id: order.id,
        status: order.status,
        kitchenStartedAt: to === 'REJECTED' ? null : undefined,
      },
      data: { ...data, status: to },
    });
    if (count === 0) {
      throw new ConflictException({
        message: 'Someone else just changed this order. Refresh and try again.',
      });
    }
  }

  // D7: an invoice never changes, so money taken back after invoicing becomes
  // a credit that lands on the company's next invoice.
  private async creditIfInvoiced(
    order: { id: number; invoiceId: number | null; total: number },
    reason: string,
  ) {
    if (order.invoiceId) {
      await this.db.adjustment.create({
        data: { orderId: order.id, amount: -order.total, reason },
      });
    }
  }

  /** Admin override of delivery details after confirmation (spec 4.6). */
  async overrideDelivery(id: number, input: DeliveryOverride) {
    const order = await this.find(id);
    if (order.status !== 'CONFIRMED' || order.outForDeliveryAt) {
      throw new ConflictException({
        message: 'Delivery details can only be changed on confirmed orders that haven’t left yet',
      });
    }
    const address = await this.db.address.findUnique({ where: { id: input.addressId } });
    if (address?.companyId !== order.companyId) {
      throw bad('addressId', "That address doesn't belong to this order's company");
    }
    // The planned kitchen and dispatch times follow automatically: they're
    // worked out from the delivery time whenever they're shown.
    return this.db.order.update({ where: { id }, data: input });
  }

  private async find(id: number) {
    const order = await this.db.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException({ message: 'Order not found' });
    return order;
  }

  // ---------- Cut-off processing ----------

  /**
   * When a date's cut-off passes: drafts are cancelled and placed orders are
   * confirmed (and become billable). Both updates only touch orders still in
   * that status, so running this twice for the same date changes nothing.
   */
  async processDate(day: Day, cutoffAt: Date) {
    const deliveryDate = new Date(day);
    const [cancelled, confirmed] = await this.db.$transaction([
      this.db.order.updateMany({
        where: { deliveryDate, status: 'DRAFT' },
        data: { status: 'CANCELLED', cancelledAt: cutoffAt },
      }),
      this.db.order.updateMany({
        where: { deliveryDate, status: 'PLACED' },
        data: { status: 'CONFIRMED', confirmedAt: cutoffAt },
      }),
    ]);
    if (cancelled.count || confirmed.count) {
      this.log.log(
        `Cut-off ${day}: ${confirmed.count} confirmed, ${cancelled.count} drafts cancelled`,
      );
    }
    return { cancelled: cancelled.count, confirmed: confirmed.count };
  }

  // Runs every minute, and before lists and boards load, because free hosting
  // may be asleep when the timer should have fired.
  @Interval(60_000)
  async processDueCutoffs() {
    const pending = await this.db.order.findMany({
      where: { status: { in: OPEN } },
      distinct: ['deliveryDate'],
      select: { deliveryDate: true },
    });
    const now = new Date();
    for (const { deliveryDate } of pending) {
      const day = dayOf(deliveryDate);
      const cutoffAt = await this.cutoffOf(day);
      if (cutoffAt <= now) await this.processDate(day, cutoffAt);
    }
  }

  /** Manual trigger for a cut-off that has already passed (spec 4.6). */
  async runCutoff(day: Day) {
    const cutoffAt = await this.cutoffOf(day);
    if (cutoffAt > new Date()) {
      throw bad('date', `The cut-off for that date hasn't passed yet (${cutoffAt.toISOString()})`);
    }
    return { cutoffAt: cutoffAt.toISOString(), ...(await this.processDate(day, cutoffAt)) };
  }

  // ---------- Reading ----------

  async list(query: OrderQuery): Promise<OrderPage> {
    await this.processDueCutoffs();
    const where: Prisma.OrderWhereInput = {
      status: query.status,
      companyId: query.companyId,
      deliveryDate: {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(query.to) : undefined,
      },
      invoiceId: query.invoiced === undefined ? undefined : query.invoiced ? { not: null } : null,
    };
    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { employee: { name: { contains: q, mode: 'insensitive' } } },
        { employee: { email: { contains: q, mode: 'insensitive' } } },
        { company: { name: { contains: q, mode: 'insensitive' } } },
        ...(/^\d+$/.test(q.replace('#', '')) ? [{ id: Number(q.replace('#', '')) }] : []),
      ];
    }
    const [rows, total] = await Promise.all([
      this.db.order.findMany({
        where,
        orderBy: [{ deliveryDate: 'desc' }, { deliveryTime: 'asc' }, { id: 'desc' }],
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { employee: { select: { name: true } }, company: { select: { name: true } } },
      }),
      this.db.order.count({ where }),
    ]);
    return {
      items: rows.map((o) => ({
        id: o.id,
        status: o.status,
        deliveryDate: dayOf(o.deliveryDate),
        deliveryTime: o.deliveryTime,
        total: o.total,
        invoiced: o.invoiceId !== null,
        employee: o.employee,
        company: o.company,
      })),
      total,
      page: query.page,
      pageSize: PAGE_SIZE,
    };
  }

  async detail(user: User, id: number): Promise<OrderDetail> {
    await this.processDueCutoffs();
    const order = await this.db.order.findUnique({
      where: { id },
      include: {
        employee: true,
        company: true,
        address: true,
        packagingType: true,
        driver: true,
        invoice: true,
        adjustments: { orderBy: { createdAt: 'asc' } },
        lines: { orderBy: { id: 'asc' }, include: { combos: { orderBy: { id: 'asc' } } } },
      },
    });
    if (!order) throw new NotFoundException({ message: 'Order not found' });
    const { settings } = await this.kitchen();
    const day = dayOf(order.deliveryDate);
    const cutoffAt = await this.cutoffOf(day);
    const cutoffPassed = cutoffAt <= new Date();
    const plan = plannedTimes(
      day,
      order.deliveryTime,
      order.company.dispatchLeadMinutes,
      settings.kitchenBufferMinutes,
    );
    const manage = can(user.role, 'orders.manage');
    const override = can(user.role, 'orders.override');
    const open = OPEN.includes(order.status);

    const events: [string, Date | null][] = [
      ['Created', order.createdAt],
      ['Placed', order.placedAt],
      ['Confirmed', order.confirmedAt],
      ['Kitchen started', order.kitchenStartedAt],
      ['Kitchen ready', order.kitchenReadyAt],
      ['Ready for dispatch', order.dispatchReadyAt],
      ['Out for delivery', order.outForDeliveryAt],
      ['Delivered', order.deliveredAt],
      ['Cancelled', order.cancelledAt],
      [`Rejected: ${order.rejectReason}`, order.rejectedAt],
    ];

    return {
      id: order.id,
      status: order.status,
      deliveryDate: day,
      deliveryTime: order.deliveryTime,
      total: order.total,
      employee: { id: order.employee.id, name: order.employee.name, email: order.employee.email },
      company: {
        id: order.company.id,
        name: order.company.name,
        driverInstructions: order.company.driverInstructions,
      },
      address: { id: order.address.id, label: order.address.label, text: order.address.text },
      packagingType: order.packagingType && {
        id: order.packagingType.id,
        name: order.packagingType.name,
      },
      driver: order.driver && { name: order.driver.name },
      invoice: order.invoice && {
        id: order.invoice.id,
        paidAt: order.invoice.paidAt?.toISOString() ?? null,
      },
      rejectReason: order.rejectReason,
      deliveryNote: order.deliveryNote,
      deliveredOnTime: order.deliveredOnTime,
      lines: order.lines.map((line) => ({
        id: line.id,
        dishId: line.dishId,
        dishName: line.dishName,
        dishPrice: line.dishPrice,
        quantity: line.quantity,
        total: line.total,
        combos: line.combos.map((combo) => ({
          id: combo.id,
          quantity: combo.quantity,
          unitPrice: combo.unitPrice,
          total: combo.total,
          choices: combo.choices as OrderDetail['lines'][number]['combos'][number]['choices'],
        })),
      })),
      adjustments: order.adjustments.map((a) => ({
        id: a.id,
        amount: a.amount,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
      })),
      cutoffAt: cutoffAt.toISOString(),
      cutoffPassed,
      plan: {
        dispatchReadyBy: plan.dispatchReadyBy.toISOString(),
        kitchenReadyBy: plan.kitchenReadyBy.toISOString(),
      },
      timeline: events
        .filter((event): event is [string, Date] => event[1] !== null)
        .sort((a, b) => a[1].getTime() - b[1].getTime())
        .map(([label, at]) => ({ label, at: at.toISOString() })),
      can: {
        edit: open && manage && (!cutoffPassed || override),
        cancel:
          manage &&
          ((open && (!cutoffPassed || override)) || (order.status === 'CONFIRMED' && override)),
        reject:
          override && ['PLACED', 'CONFIRMED'].includes(order.status) && !order.kitchenStartedAt,
        override: override && order.status === 'CONFIRMED' && !order.outForDeliveryAt,
      },
    };
  }
}
