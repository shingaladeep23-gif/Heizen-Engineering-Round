// Realistic orders for the live demo (spec section 2: orders in every status,
// across past dates, today and the coming week, with deliveries for the
// driver today, whichever day the review happens).
//
// Every order is built from the employee's real menu with the same
// buildLines() the API uses, so demo orders obey every rule and price.
import type { PricedDish } from '@fernleaf/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { MenuService } from '../menu/menu.service.js';
import { DEMO_COMPANY_NAMES } from './catalogue-seed.js';
import {
  addDays,
  cutoffFor,
  dayOf,
  isOpen,
  istInstant,
  minutesBefore,
  plannedTimes,
  todayIST,
  type Calendar,
  type Day,
} from '../orders/calendar.js';
import { deliveredOnTime } from '../dispatch/dispatch-rules.js';
import { buildLines, type LineInput } from '../orders/order-rules.js';

const HISTORY_DAYS = 14;
const AHEAD_DAYS = 7;
const NOTES = ['Left with reception', 'Handed to the pantry team', 'Security signed for it', null];
const REJECT_REASONS = ['Out of paneer for that day', 'Duplicate of another order'];

// A tiny seeded random number generator: the same day always gets the same orders.
function random(seed: string) {
  let h = 7;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const minutesAfter = (instant: Date, minutes: number) => minutesBefore(instant, -minutes);

// A plausible lunch: one or two dishes, required choices filled, the odd
// add-on, and sometimes the same dish split into two combinations.
function pickLines(menu: PricedDish[], rand: () => number): LineInput[] {
  const choices = menu.filter((d) => !d.minOrderQty || d.minOrderQty <= 2);
  const count = rand() < 0.3 ? 2 : 1;
  const dishes = [...choices].sort(() => rand() - 0.5).slice(0, count);
  return dishes.map((dish) => {
    const quantity = Math.max(dish.minOrderQty ?? 1, rand() < 0.2 ? 2 : 1);
    const pick = (variant: number) =>
      dish.groups.flatMap((g) =>
        g.required
          ? [g.options[(Math.floor(rand() * g.options.length) + variant) % g.options.length].id]
          : rand() < 0.35
            ? [g.options[0].id]
            : [],
      );
    // In a group with portions, about one in three goes Large (its second size).
    const sized = (optionIds: number[]) =>
      dish.groups.flatMap((g) =>
        g.sizes.length > 1
          ? g.options
              .filter((o) => optionIds.includes(o.id) && rand() < 0.3)
              .map((o) => ({ optionId: o.id, sizeId: g.sizes[1].id }))
          : [],
      );
    const combo = (n: number, optionIds: number[]) => ({
      quantity: n,
      optionIds,
      sizes: sized(optionIds),
    });
    const split = quantity === 2 && dish.groups.some((g) => g.required && g.options.length > 1);
    return {
      dishId: dish.id,
      quantity,
      combos: split ? [combo(1, pick(0)), combo(1, pick(1))] : [combo(quantity, pick(0))],
    };
  });
}

type Progress = 'delivered' | 'out' | 'ready' | 'cooked' | 'cooking' | 'todo';

// Timestamps for an order that has got as far as `progress` on its day.
function timeline(
  plan: ReturnType<typeof plannedTimes>,
  progress: Progress,
  rand: () => number,
  graceMinutes: number,
) {
  const late = rand() < 0.15; // some days don't go to plan
  const kitchenStartedAt = minutesBefore(plan.kitchenReadyBy, 50);
  const kitchenReadyAt = minutesAfter(plan.kitchenReadyBy, late ? 12 : -Math.round(rand() * 10));
  const dispatchReadyAt = minutesAfter(plan.dispatchReadyBy, late ? 10 : -5);
  const outForDeliveryAt = minutesAfter(plan.dispatchReadyBy, late ? 15 : 0);
  const deliveredAt = minutesAfter(plan.deliverAt, late ? 18 : -Math.round(rand() * 15));
  const reached = (stage: Progress) =>
    ['delivered', 'out', 'ready', 'cooked', 'cooking', 'todo'].indexOf(progress) <=
    ['delivered', 'out', 'ready', 'cooked', 'cooking', 'todo'].indexOf(stage);
  return {
    kitchenStartedAt: reached('cooking') ? kitchenStartedAt : null,
    kitchenReadyAt: reached('cooked') ? kitchenReadyAt : null,
    dispatchReadyAt: reached('ready') ? dispatchReadyAt : null,
    outForDeliveryAt: reached('out') ? outForDeliveryAt : null,
    deliveredAt: reached('delivered') ? deliveredAt : null,
    deliveredOnTime: reached('delivered')
      ? deliveredOnTime(deliveredAt, plan.deliverAt, graceMinutes)
      : null,
  };
}

export class DemoOrders {
  private readonly menus = new Map<number, PricedDish[]>();

  constructor(
    private readonly db: PrismaClient,
    private readonly menuService: MenuService,
  ) {}

  /**
   * Fills the last two weeks and the coming week with orders for the demo
   * companies, one (day, company) at a time, but only where that company has
   * no orders at all that day. Anything a reviewer (or a test) created is
   * never touched and never blocks the rest of the day. Safe to stop halfway
   * and run again: it carries on from what's missing.
   */
  async topUp(now = new Date()) {
    const today = todayIST(now);
    const from = addDays(today, -HISTORY_DAYS);
    const [settings, holidays, companies, existing] = await Promise.all([
      this.db.settings.findUniqueOrThrow({ where: { id: 1 } }),
      this.db.kitchenHoliday.findMany(),
      this.db.company.findMany({
        where: { name: { in: DEMO_COMPANY_NAMES } },
        include: { employees: true, addresses: true, holidays: true },
      }),
      this.db.order.findMany({
        where: { deliveryDate: { gte: new Date(from) } },
        distinct: ['deliveryDate', 'companyId'],
        select: { deliveryDate: true, companyId: true },
      }),
    ]);
    const kitchen: Calendar = {
      workingDays: settings.kitchenWorkingDays,
      holidays: new Set(holidays.map((h) => dayOf(h.date))),
    };
    const filled = new Set(existing.map((o) => `${dayOf(o.deliveryDate)}|${o.companyId}`));

    let created = 0;
    const todayIds: number[] = [];
    for (let offset = -HISTORY_DAYS; offset <= AHEAD_DAYS; offset++) {
      const day = addDays(today, offset);
      if (!isOpen(kitchen, day)) continue;
      const cutoffAt = cutoffFor(day, kitchen, settings.cutoffDays, settings.cutoffTime);
      for (const company of companies) {
        const open = isOpen(
          {
            workingDays: company.workingDays,
            holidays: new Set(company.holidays.map((h) => dayOf(h.date))),
          },
          day,
        );
        if (open && !filled.has(`${day}|${company.id}`)) {
          const ids = await this.ordersFor(company, day, offset, cutoffAt, now, settings);
          created += ids.length;
          if (offset === 0) todayIds.push(...ids);
        }
      }
    }
    if (todayIds.length) await this.stageToday(todayIds, now, settings);
    if ((await this.db.invoice.count()) === 0) await this.invoiceHistory(today);
    return created;
  }

  private async menuFor(employeeId: number) {
    if (!this.menus.has(employeeId)) {
      const menu = await this.menuService.menuFor(employeeId);
      // Every demo company takes lunch (12:00 to 13:30), so no breakfast dishes.
      this.menus.set(
        employeeId,
        menu.categories.filter((c) => c.name !== 'Breakfast').flatMap((c) => c.dishes),
      );
    }
    return this.menus.get(employeeId)!;
  }

  private async ordersFor(
    company: Prisma.CompanyGetPayload<{ include: { employees: true; addresses: true } }>,
    day: Day,
    offset: number,
    cutoffAt: Date,
    now: Date,
    settings: { kitchenBufferMinutes: number; onTimeGraceMinutes: number },
  ) {
    const rand = random(`${day}-${company.id}`);
    const people = [...company.employees]
      .sort(() => rand() - 0.5)
      .slice(0, 3 + Math.floor(rand() * 4));
    const ids: number[] = [];

    for (const employee of people) {
      const menu = await this.menuFor(employee.id);
      if (menu.length === 0) continue;
      let built: ReturnType<typeof buildLines>;
      try {
        built = buildLines(new Map(menu.map((d) => [d.id, d])), pickLines(menu, rand));
      } catch {
        continue; // an unlucky combination; just skip this one
      }

      // Most eat at the usual time; people allowed to change it sometimes do.
      const deliveryTime = employee.canChangeTime && rand() < 0.3 ? '13:15' : company.deliveryTime;
      const address =
        employee.canChooseAddress && company.addresses.length > 1 && rand() < 0.3
          ? company.addresses[1]
          : company.addresses.find((a) => a.id === company.defaultAddressId)!;
      const plan = plannedTimes(
        day,
        deliveryTime,
        company.dispatchLeadMinutes,
        settings.kitchenBufferMinutes,
      );
      const createdAt = new Date(
        Math.min(
          minutesBefore(cutoffAt, 60 * 24 + Math.round(rand() * 600)).getTime(),
          now.getTime() - 3_600_000,
        ),
      );

      let status: Prisma.OrderCreateInput['status'];
      let extra: Partial<Prisma.OrderUncheckedCreateInput> = {};
      const r = rand();
      if (offset < 0) {
        // History: mostly delivered, a few cancelled before the cut-off or rejected.
        if (r < 0.05) {
          status = 'CANCELLED';
          extra = { cancelledAt: minutesAfter(createdAt, 90) };
        } else if (r < 0.08) {
          status = 'REJECTED';
          extra = {
            placedAt: createdAt,
            confirmedAt: cutoffAt,
            rejectedAt: minutesAfter(cutoffAt, 120),
            rejectReason: REJECT_REASONS[Math.floor(rand() * REJECT_REASONS.length)],
          };
        } else {
          status = 'DELIVERED';
          extra = {
            placedAt: createdAt,
            confirmedAt: cutoffAt,
            driverId: company.defaultDriverId,
            deliveryNote: NOTES[Math.floor(rand() * NOTES.length)],
            ...timeline(plan, 'delivered', rand, settings.onTimeGraceMinutes),
          };
        }
      } else if (offset === 0) {
        // Today: confirmed for now; stageToday() then spreads the day's drops
        // across the board.
        status = 'CONFIRMED';
        extra = { placedAt: createdAt, confirmedAt: cutoffAt, driverId: company.defaultDriverId };
      } else if (cutoffAt <= now) {
        status = 'CONFIRMED';
        extra = { placedAt: createdAt, confirmedAt: cutoffAt, driverId: company.defaultDriverId };
      } else {
        status = r < 0.1 ? 'DRAFT' : 'PLACED';
        extra = { placedAt: status === 'PLACED' ? createdAt : null };
      }

      const done = extra.kitchenReadyAt ?? null;
      const started = extra.kitchenStartedAt ?? null;
      const order = await this.db.order.create({
        data: {
          employeeId: employee.id,
          companyId: company.id,
          status,
          deliveryDate: new Date(day),
          deliveryTime,
          addressId: address.id,
          packagingTypeId: company.packagingTypeId,
          total: built.total,
          createdAt,
          ...extra,
          lines: {
            create: built.lines.map(({ combos, ...line }) => ({
              ...line,
              combos: {
                // Units are done when the order is; an order in progress has started some.
                create: combos.map((combo, i) => ({
                  ...combo,
                  startedAt: done ?? (started && i === 0 ? started : null),
                  doneAt: done,
                })),
              },
            })),
          },
        },
      });
      ids.push(order.id);
    }
    return ids;
  }

  /**
   * Spreads today's new orders across the board, a whole drop at a time,
   * earliest first: one drop out for delivery, one cooking, one ready to go,
   * one still to do, one cooked, and round again. So every board has
   * something to show whatever day it is, and a drop is never half out.
   */
  private async stageToday(
    ids: number[],
    now: Date,
    settings: { kitchenBufferMinutes: number; onTimeGraceMinutes: number },
  ) {
    const orders = await this.db.order.findMany({
      where: { id: { in: ids } },
      orderBy: [{ deliveryTime: 'asc' }, { companyId: 'asc' }],
      include: { company: true, lines: { include: { combos: true } } },
    });
    const drops = new Map<string, typeof orders>();
    for (const order of orders) {
      const key = `${order.companyId}|${order.addressId}|${order.deliveryTime}`;
      drops.set(key, [...(drops.get(key) ?? []), order]);
    }
    const PATTERN: Progress[] = ['out', 'cooking', 'ready', 'todo', 'cooked'];
    for (const [rank, drop] of [...drops.values()].entries()) {
      for (const order of drop) {
        const plan = plannedTimes(
          dayOf(order.deliveryDate),
          order.deliveryTime,
          order.company.dispatchLeadMinutes,
          settings.kitchenBufferMinutes,
        );
        const steps = timeline(
          plan,
          PATTERN[rank % PATTERN.length],
          random(`${order.id}`),
          settings.onTimeGraceMinutes,
        );
        // Nothing can have happened later than now: pull planned times back.
        const keys = [
          'kitchenStartedAt',
          'kitchenReadyAt',
          'dispatchReadyAt',
          'outForDeliveryAt',
        ] as const;
        keys.forEach((key, i) => {
          const at = steps[key];
          if (at && at > now) steps[key] = minutesBefore(now, (keys.length - i) * 6);
        });
        // Only if it's still untouched: a cancel or a cook may have got there first.
        const { count } = await this.db.order.updateMany({
          where: { id: order.id, status: 'CONFIRMED', kitchenStartedAt: null },
          data: {
            kitchenStartedAt: steps.kitchenStartedAt,
            kitchenReadyAt: steps.kitchenReadyAt,
            dispatchReadyAt: steps.dispatchReadyAt,
            outForDeliveryAt: steps.outForDeliveryAt,
          },
        });
        if (count === 0) continue;
        // Units are done when the order is; an order being cooked has started its first.
        for (const [i, combo] of order.lines.flatMap((l) => l.combos).entries()) {
          await this.db.orderCombo.update({
            where: { id: combo.id },
            data: {
              doneAt: steps.kitchenReadyAt,
              startedAt: steps.kitchenReadyAt ?? (i === 0 ? steps.kitchenStartedAt : null),
            },
          });
        }
      }
    }
  }

  // Older weeks are invoiced (and mostly paid); the last few days aren't yet.
  private async invoiceHistory(today: Day) {
    const companies = await this.db.company.findMany();
    for (const [i, company] of companies.entries()) {
      const batches: [Day, Day, boolean][] = [
        [addDays(today, -HISTORY_DAYS), addDays(today, -8), i % 2 === 0],
        [addDays(today, -7), addDays(today, -4), false],
      ];
      for (const [from, to, paid] of batches) {
        const orders = await this.db.order.findMany({
          where: {
            companyId: company.id,
            invoiceId: null,
            status: { in: ['CONFIRMED', 'DELIVERED'] },
            deliveryDate: { gte: new Date(from), lte: new Date(to) },
          },
        });
        if (orders.length === 0) continue;
        const createdAt = istInstant(addDays(to, 1), '10:00');
        const invoice = await this.db.invoice.create({
          data: {
            companyId: company.id,
            total: orders.reduce((sum, o) => sum + o.total, 0),
            createdAt,
            paidAt: paid ? istInstant(addDays(to, 5), '15:00') : null,
          },
        });
        await this.db.order.updateMany({
          where: { id: { in: orders.map((o) => o.id) } },
          data: { invoiceId: invoice.id },
        });
      }
    }
    // One delivery that came up short, waiting to go on the next invoice.
    const short = await this.db.order.findFirst({
      where: { status: 'DELIVERED', invoiceId: null },
      orderBy: { deliveryDate: 'desc' },
    });
    if (short) {
      await this.db.adjustment.create({
        data: {
          orderId: short.id,
          amount: -Math.min(short.total, 15000),
          reason: 'One box missing from the drop',
        },
      });
    }
  }

  /**
   * Today's orders were made days ago as future orders, so nothing has
   * happened to them yet. From 10:30 (when a real kitchen would be well into
   * lunch) spread them across the boards like stageToday() does for a fresh
   * demo, so a reviewer finds work at every stage whenever they look. Only
   * if nobody has touched today's orders yet: a reviewer's clicks always win.
   */
  async stageTodayOnce(now = new Date()) {
    const today = todayIST(now);
    if (now < istInstant(today, '10:30')) return 0;
    const where = {
      deliveryDate: new Date(today),
      status: 'CONFIRMED' as const,
      company: { name: { in: DEMO_COMPANY_NAMES } },
    };
    const [orders, touched, settings] = await Promise.all([
      this.db.order.findMany({ where, select: { id: true } }),
      this.db.order.count({ where: { ...where, kitchenStartedAt: { not: null } } }),
      this.db.settings.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    if (orders.length === 0 || touched > 0) return 0;
    await this.stageToday(
      orders.map((o) => o.id),
      now,
      settings,
    );
    return orders.length;
  }

  /**
   * Demo only: demo orders nobody finished are completed as if the team had
   * worked through them, so the boards and history stay believable for the
   * whole review period without anyone clicking. That's every earlier day,
   * plus today's deliveries more than two hours past their time. Only the
   * demo companies, and each order only if it's still CONFIRMED when it's
   * written, so a reviewer's orders, or a cancel landing meanwhile, are never
   * overwritten.
   */
  async wrapUpUnfinished(now = new Date()) {
    const today = todayIST(now);
    const [settings, unfinished] = await Promise.all([
      this.db.settings.findUniqueOrThrow({ where: { id: 1 } }),
      this.db.order.findMany({
        where: {
          status: 'CONFIRMED',
          deliveryDate: { lte: new Date(today) },
          company: { name: { in: DEMO_COMPANY_NAMES } },
        },
        include: { company: true },
      }),
    ]);
    let wrapped = 0;
    for (const order of unfinished) {
      const day = dayOf(order.deliveryDate);
      const plan = plannedTimes(
        day,
        order.deliveryTime,
        order.company.dispatchLeadMinutes,
        settings.kitchenBufferMinutes,
      );
      if (day === today && now.getTime() < plan.deliverAt.getTime() + 2 * 60 * 60_000) continue;
      const t = timeline(plan, 'delivered', random(`${order.id}`), settings.onTimeGraceMinutes);
      const { count } = await this.db.order.updateMany({
        where: { id: order.id, status: 'CONFIRMED' },
        data: {
          status: 'DELIVERED',
          driverId: order.driverId ?? order.company.defaultDriverId,
          kitchenStartedAt: order.kitchenStartedAt ?? t.kitchenStartedAt,
          kitchenReadyAt: order.kitchenReadyAt ?? t.kitchenReadyAt,
          dispatchReadyAt: order.dispatchReadyAt ?? t.dispatchReadyAt,
          outForDeliveryAt: order.outForDeliveryAt ?? t.outForDeliveryAt,
          deliveredAt: t.deliveredAt,
          deliveredOnTime: t.deliveredOnTime,
        },
      });
      if (count === 0) continue;
      await this.db.orderCombo.updateMany({
        where: { line: { orderId: order.id }, doneAt: null },
        data: { doneAt: t.kitchenReadyAt, startedAt: t.kitchenStartedAt },
      });
      wrapped++;
    }
    return wrapped;
  }
}
