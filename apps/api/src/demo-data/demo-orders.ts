// Realistic orders for the live demo (spec section 2: orders in every status,
// across past dates, today and the coming week, with deliveries for the
// driver today, whichever day the review happens).
//
// Every order is built from the employee's real menu with the same
// buildLines() the API uses, so demo orders obey every rule and price.
import type { PricedDish } from '@fernleaf/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { MenuService } from '../menu/menu.service.js';
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
  let h = [...seed].reduce((a, c) => Math.imul(31, a) + c.charCodeAt(0), 7) | 0;
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
    const split = quantity === 2 && dish.groups.some((g) => g.required && g.options.length > 1);
    return {
      dishId: dish.id,
      quantity,
      combos: split
        ? [
            { quantity: 1, optionIds: pick(0) },
            { quantity: 1, optionIds: pick(1) },
          ]
        : [{ quantity, optionIds: pick(0) }],
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
   * Fills every open day from two weeks ago (first run only) to a week ahead
   * with orders, but only days that have none yet. Existing orders, including
   * anything a reviewer created, are never touched.
   */
  async topUp(now = new Date()) {
    const firstRun = (await this.db.order.count()) === 0;
    const today = todayIST(now);
    const [settings, holidays, companies] = await Promise.all([
      this.db.settings.findUniqueOrThrow({ where: { id: 1 } }),
      this.db.kitchenHoliday.findMany(),
      this.db.company.findMany({ include: { employees: true, addresses: true, holidays: true } }),
    ]);
    const kitchen: Calendar = {
      workingDays: settings.kitchenWorkingDays,
      holidays: new Set(holidays.map((h) => dayOf(h.date))),
    };
    const filled = new Set(
      (
        await this.db.order.findMany({
          where: { deliveryDate: { gte: new Date(addDays(today, -HISTORY_DAYS)) } },
          distinct: ['deliveryDate'],
          select: { deliveryDate: true },
        })
      ).map((o) => dayOf(o.deliveryDate)),
    );

    let created = 0;
    for (let offset = firstRun ? -HISTORY_DAYS : 0; offset <= AHEAD_DAYS; offset++) {
      const day = addDays(today, offset);
      if (filled.has(day) || !isOpen(kitchen, day)) continue;
      const cutoffAt = cutoffFor(day, kitchen, settings.cutoffDays, settings.cutoffTime);
      for (const company of companies) {
        const open = isOpen(
          {
            workingDays: company.workingDays,
            holidays: new Set(company.holidays.map((h) => dayOf(h.date))),
          },
          day,
        );
        if (open) created += await this.ordersFor(company, day, offset, cutoffAt, now, settings);
      }
    }
    if (firstRun) await this.invoiceHistory(today);
    return created;
  }

  private async menuFor(employeeId: number) {
    if (!this.menus.has(employeeId)) {
      const menu = await this.menuService.menuFor(employeeId);
      this.menus.set(
        employeeId,
        menu.categories.flatMap((c) => c.dishes),
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
    let count = 0;

    for (const [index, employee] of people.entries()) {
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
        // Today: spread across the board. The earliest orders are already on
        // the road, so the driver has something to deliver straight away.
        const progress: Progress = (['out', 'out', 'ready', 'cooked', 'cooking', 'todo'] as const)[
          Math.min(index, 5)
        ];
        // Nothing can have happened later than now: pull planned times back.
        const steps = timeline(plan, progress, rand, settings.onTimeGraceMinutes);
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
        status = 'CONFIRMED';
        extra = {
          placedAt: createdAt,
          confirmedAt: cutoffAt,
          driverId: company.defaultDriverId,
          ...steps,
        };
      } else if (cutoffAt <= now) {
        status = 'CONFIRMED';
        extra = { placedAt: createdAt, confirmedAt: cutoffAt, driverId: company.defaultDriverId };
      } else {
        status = r < 0.1 ? 'DRAFT' : 'PLACED';
        extra = { placedAt: status === 'PLACED' ? createdAt : null };
      }

      const done = extra.kitchenReadyAt ?? null;
      const started = extra.kitchenStartedAt ?? null;
      await this.db.order.create({
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
      count++;
    }
    return count;
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
   * Demo only: yesterday's unfinished orders are completed overnight, as if
   * the team had worked through them, so the history stays realistic for the
   * whole review period. Only orders still CONFIRMED on a past date move.
   */
  async completePastDays(now = new Date()) {
    const today = todayIST(now);
    const [settings, stale] = await Promise.all([
      this.db.settings.findUniqueOrThrow({ where: { id: 1 } }),
      this.db.order.findMany({
        where: { status: 'CONFIRMED', deliveryDate: { lt: new Date(today) } },
        include: { company: true },
      }),
    ]);
    for (const order of stale) {
      const day = dayOf(order.deliveryDate);
      const plan = plannedTimes(
        day,
        order.deliveryTime,
        order.company.dispatchLeadMinutes,
        settings.kitchenBufferMinutes,
      );
      const t = timeline(plan, 'delivered', random(`${order.id}`), settings.onTimeGraceMinutes);
      await this.db.order.update({
        where: { id: order.id },
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
      await this.db.orderCombo.updateMany({
        where: { line: { orderId: order.id }, doneAt: null },
        data: { doneAt: t.kitchenReadyAt, startedAt: t.kitchenStartedAt },
      });
    }
    return stale.length;
  }
}
