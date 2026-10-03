import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { can, ROLES, type Drop, type DropRef, type DropStep } from '@fernleaf/shared';
import { PrismaService } from '../prisma.service.js';
import { plannedTimes, type Day } from '../orders/calendar.js';
import { OrdersService } from '../orders/orders.service.js';
import { deliveredOnTime, stageOf, stepField, stepProblem } from './dispatch-rules.js';

// Whoever can do deliveries counts as a driver. No role names here.
const DRIVER_ROLES = ROLES.filter((role) => can(role, 'deliveries.own'));

const dropWhere = (ref: DropRef) => ({
  companyId: ref.companyId,
  addressId: ref.addressId,
  deliveryDate: new Date(ref.date),
  deliveryTime: ref.time,
  status: { in: ['CONFIRMED' as const, 'DELIVERED' as const] },
});

@Injectable()
export class DispatchService {
  constructor(
    private readonly db: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  drivers() {
    return this.db.user.findMany({
      where: { role: { in: DRIVER_ROLES }, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  /** Confirmed orders for a date, grouped into drops, in delivery-time order. */
  async drops(day: Day, driverId?: number): Promise<Drop[]> {
    await this.orders.processDueCutoffsSoon();
    const [settings, orders] = await Promise.all([
      this.db.settings.findUniqueOrThrow({ where: { id: 1 } }),
      this.db.order.findMany({
        where: {
          deliveryDate: new Date(day),
          status: { in: ['CONFIRMED', 'DELIVERED'] },
          driverId,
        },
        orderBy: [{ deliveryTime: 'asc' }, { id: 'asc' }],
        include: {
          company: true,
          address: true,
          driver: { select: { id: true, name: true } },
          employee: { select: { name: true } },
          lines: { select: { dishName: true, quantity: true } },
        },
      }),
    ]);

    const groups = new Map<string, typeof orders>();
    for (const order of orders) {
      const key = `${order.companyId}|${order.addressId}|${order.deliveryTime}`;
      groups.set(key, [...(groups.get(key) ?? []), order]);
    }

    const now = new Date();
    return [...groups.values()].map((group) => {
      const first = group[0];
      const plan = plannedTimes(
        day,
        first.deliveryTime,
        first.company.dispatchLeadMinutes,
        settings.kitchenBufferMinutes,
      );
      const stage = stageOf(group);
      // Delivery details only make sense once the whole drop has arrived.
      const delivered = stage === 'delivered' ? group.find((o) => o.deliveredAt) : undefined;
      return {
        ref: {
          companyId: first.companyId,
          addressId: first.addressId,
          date: day,
          time: first.deliveryTime,
        },
        company: { id: first.company.id, name: first.company.name },
        address: { id: first.address.id, label: first.address.label, text: first.address.text },
        driverInstructions: first.company.driverInstructions,
        driver: group.every((o) => o.driverId === first.driverId) ? first.driver : null,
        stage,
        dispatchReadyBy: plan.dispatchReadyBy.toISOString(),
        late: delivered
          ? delivered.deliveredOnTime === false
          : !['out', 'delivered'].includes(stage) && now > plan.dispatchReadyBy,
        deliveredAt: delivered?.deliveredAt?.toISOString() ?? null,
        deliveredOnTime: delivered?.deliveredOnTime ?? null,
        note: delivered?.deliveryNote ?? null,
        orders: group.map((o) => ({
          id: o.id,
          employee: o.employee.name,
          items: o.lines.map((l) => `${l.quantity} × ${l.dishName}`).join(', '),
          kitchenReady: o.kitchenReadyAt !== null,
        })),
        portions: group.reduce((sum, o) => sum + o.lines.reduce((s, l) => s + l.quantity, 0), 0),
      };
    });
  }

  /** Dispatch picks the driver for a whole drop, before it leaves. */
  async assign(ref: DropRef, driverId: number) {
    const driver = await this.db.user.findUnique({ where: { id: driverId } });
    if (!driver?.active || !DRIVER_ROLES.includes(driver.role)) {
      throw new BadRequestException({ message: "That person isn't an active driver" });
    }
    return this.db.$transaction(async (tx) => {
      const orders = await this.lockDrop(tx, ref);
      if (orders.some((o) => o.outForDeliveryAt)) {
        throw new ConflictException({
          message: 'This drop has already left; the driver can’t change',
        });
      }
      await tx.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) } },
        data: { driverId },
      });
    });
  }

  /**
   * Moves a whole drop one step. All its orders are locked first, so two
   * dispatchers clicking at once can't both apply the step.
   * `onlyDriverId` limits a driver to their own drops.
   */
  async step(
    ref: DropRef,
    step: DropStep,
    delivery?: { note: string; photo: string | null },
    onlyDriverId?: number,
  ) {
    return this.db.$transaction(async (tx) => {
      const orders = await this.lockDrop(tx, ref);
      if (onlyDriverId !== undefined && orders.some((o) => o.driverId !== onlyDriverId)) {
        throw new ForbiddenException({ message: 'This isn’t one of your deliveries' });
      }
      const problem = stepProblem(orders, step);
      if (problem) throw new ConflictException({ message: problem });

      const now = new Date();
      const pending = { id: { in: orders.map((o) => o.id) }, [stepField(step)]: null };
      if (step !== 'delivered') {
        await tx.order.updateMany({ where: pending, data: { [stepField(step)]: now } });
        return;
      }
      const [settings, company] = await Promise.all([
        tx.settings.findUniqueOrThrow({ where: { id: 1 } }),
        tx.company.findUniqueOrThrow({ where: { id: ref.companyId } }),
      ]);
      const { deliverAt } = plannedTimes(ref.date, ref.time, company.dispatchLeadMinutes, 0);
      await tx.order.updateMany({
        where: pending,
        data: {
          status: 'DELIVERED',
          deliveredAt: now,
          deliveredOnTime: deliveredOnTime(now, deliverAt, settings.onTimeGraceMinutes),
          deliveryNote: delivery?.note || null,
          deliveryPhoto: delivery?.photo ?? null,
        },
      });
    });
  }

  private async lockDrop(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    ref: DropRef,
  ) {
    const ids = (await tx.order.findMany({ where: dropWhere(ref), select: { id: true } })).map(
      (o) => o.id,
    );
    if (ids.length === 0)
      throw new NotFoundException({ message: 'No confirmed orders in that drop' });
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ANY(${ids}) FOR UPDATE`;
    return tx.order.findMany({ where: { id: { in: ids } } });
  }
}
