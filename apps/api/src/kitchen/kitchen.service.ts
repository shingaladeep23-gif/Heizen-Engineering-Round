import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Choice, KitchenBoard } from '@fernleaf/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { plannedTimes, type Day } from '../orders/calendar.js';
import { OrdersService } from '../orders/orders.service.js';
import { unitState } from './kitchen-rules.js';

@Injectable()
export class KitchenService {
  constructor(
    private readonly db: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  /**
   * Everything to cook for one delivery date, one row per prep unit, sorted by
   * when it has to be ready. One query (relation joins), so a busy day with
   * hundreds of orders stays quick.
   */
  async board(day: Day): Promise<KitchenBoard> {
    await this.orders.processDueCutoffsSoon();
    const [settings, orders] = await Promise.all([
      this.db.settings.findUniqueOrThrow({ where: { id: 1 } }),
      this.db.order.findMany({
        where: {
          deliveryDate: new Date(day),
          status: { in: ['PLACED', 'CONFIRMED', 'DELIVERED'] },
        },
        include: {
          company: { select: { name: true, dispatchLeadMinutes: true } },
          lines: {
            include: {
              combos: true,
              dish: { select: { station: { select: { name: true } } } },
            },
          },
        },
      }),
    ]);

    const now = new Date();
    const units = orders.flatMap((order) => {
      const { kitchenReadyBy } = plannedTimes(
        day,
        order.deliveryTime,
        order.company.dispatchLeadMinutes,
        settings.kitchenBufferMinutes,
      );
      return order.lines.flatMap((line) =>
        line.combos.map((combo) => ({
          id: combo.id,
          orderId: order.id,
          orderStatus: order.status as 'PLACED' | 'CONFIRMED' | 'DELIVERED',
          company: order.company.name,
          deliveryTime: order.deliveryTime,
          kitchenReadyBy: kitchenReadyBy.toISOString(),
          station: line.dish.station?.name ?? 'Unassigned',
          dishName: line.dishName,
          quantity: combo.quantity,
          choices: (combo.choices as Choice[]).map((c) => c.optionName).join(', '),
          startedAt: combo.startedAt?.toISOString() ?? null,
          doneAt: combo.doneAt?.toISOString() ?? null,
          state: unitState(
            combo,
            order.status !== 'PLACED',
            kitchenReadyBy,
            now,
            settings.atRiskMinutes,
          ),
        })),
      );
    });
    units.sort((a, b) => a.kitchenReadyBy.localeCompare(b.kitchenReadyBy) || a.orderId - b.orderId);
    return { date: day, generatedAt: now.toISOString(), units };
  }

  /**
   * Start or finish one unit. The order row is locked first, so two cooks
   * clicking the same unit (or the last two units of an order) at the same
   * moment are handled one after the other, never half-applied.
   */
  async mark(unitId: number, action: 'start' | 'done') {
    const unit = await this.db.orderCombo.findUnique({
      where: { id: unitId },
      select: { line: { select: { orderId: true } } },
    });
    if (!unit) throw new NotFoundException({ message: 'Unit not found' });
    const orderId = unit.line.orderId;

    return this.db.$transaction(async (tx) => {
      const order = await this.lockConfirmed(tx, orderId);
      const now = new Date();
      const current = await tx.orderCombo.findUniqueOrThrow({ where: { id: unitId } });

      if (action === 'start') {
        if (current.startedAt)
          throw new ConflictException({ message: 'This unit was already started' });
        await tx.orderCombo.update({ where: { id: unitId }, data: { startedAt: now } });
      } else {
        if (current.doneAt) throw new ConflictException({ message: 'This unit is already done' });
        // Finishing something never started is fine, and counts as starting it too.
        await tx.orderCombo.update({
          where: { id: unitId },
          data: { doneAt: now, startedAt: current.startedAt ?? now },
        });
      }
      await this.rollUp(tx, order.id, order.kitchenStartedAt, now);
    });
  }

  /** Admin: mark every unit of an order done in one go (spec 4.7). */
  async forceComplete(orderId: number) {
    return this.db.$transaction(async (tx) => {
      const order = await this.lockConfirmed(tx, orderId);
      const now = new Date();
      const units = await tx.orderCombo.findMany({ where: { line: { orderId }, doneAt: null } });
      for (const unit of units) {
        await tx.orderCombo.update({
          where: { id: unit.id },
          data: { doneAt: now, startedAt: unit.startedAt ?? now },
        });
      }
      await this.rollUp(tx, order.id, order.kitchenStartedAt, now);
    });
  }

  private async lockConfirmed(tx: Prisma.TransactionClient, orderId: number) {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status !== 'CONFIRMED') {
      throw new ConflictException({ message: 'Only confirmed orders can be worked on' });
    }
    return order;
  }

  // The order's "kitchen started" is its first unit's start; "kitchen ready"
  // is set only once every unit is done.
  private async rollUp(
    tx: Prisma.TransactionClient,
    orderId: number,
    startedAt: Date | null,
    now: Date,
  ) {
    const remaining = await tx.orderCombo.count({ where: { line: { orderId }, doneAt: null } });
    await tx.order.update({
      where: { id: orderId },
      data: {
        kitchenStartedAt: startedAt ?? now,
        ...(remaining === 0 && { kitchenReadyAt: now }),
      },
    });
  }
}
