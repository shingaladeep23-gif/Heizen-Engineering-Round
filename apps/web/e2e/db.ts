// Test-only fixtures that write to the local database directly, for states the
// API (rightly) won't create on demand, e.g. a delivery for *today* when today
// is a weekend. Local runs only: these never touch the live site.
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasourceUrl:
    process.env.DATABASE_URL ?? 'postgresql://fernleaf:fernleaf@localhost:5432/fernleaf',
});

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * A cooked order for today, ready to go and out for delivery with the given
 * driver. For Priya Raman unless another employee is named by id, so a test
 * can keep its drops to its own company.
 */
export async function todayOutForDelivery(driverEmail: string | null, employeeId?: number) {
  const driver = driverEmail
    ? await db.user.findUniqueOrThrow({ where: { email: driverEmail } })
    : null;
  const employee = await db.employee.findFirstOrThrow({
    where: employeeId ? { id: employeeId } : { name: 'Priya Raman' },
    include: { company: true },
  });
  // A time later today that no other order of this company has yet, so the
  // drop is ours alone and still on time. Never past 23:59, so a late-night
  // run doesn't wrap into tomorrow (it used to pin every one to 23:59, which
  // put several tests' orders into one drop).
  const pad = (n: number) => String(n).padStart(2, '0');
  const ist = new Date(Date.now() + 330 * 60_000);
  const taken = new Set(
    (
      await db.order.findMany({
        where: { companyId: employee.companyId, deliveryDate: new Date(todayIST()) },
        select: { deliveryTime: true },
      })
    ).map((o) => o.deliveryTime),
  );
  const free: string[] = [];
  for (let m = ist.getUTCHours() * 60 + ist.getUTCMinutes() + 2; m < 24 * 60; m++) {
    const t = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    if (!taken.has(t)) free.push(t);
  }
  // Somewhere in the next free hour or so, at random, so parallel tests rarely pick the same.
  const time = free.length ? free[Math.floor(Math.random() * Math.min(free.length, 60))] : '23:59';
  const now = new Date();
  const order = await db.order.create({
    data: {
      employeeId: employee.id,
      companyId: employee.companyId,
      addressId: employee.company.defaultAddressId!,
      status: 'CONFIRMED',
      deliveryDate: new Date(todayIST()),
      deliveryTime: time,
      total: 19800,
      driverId: driver?.id ?? null,
      placedAt: now,
      confirmedAt: now,
      kitchenStartedAt: now,
      kitchenReadyAt: now,
      dispatchReadyAt: now,
      outForDeliveryAt: now,
      lines: {
        create: {
          dishId: 3,
          dishName: 'Rajma Chawal Bowl',
          dishPrice: 19800,
          quantity: 1,
          total: 19800,
          combos: {
            create: {
              quantity: 1,
              unitPrice: 19800,
              total: 19800,
              choices: [],
              startedAt: now,
              doneAt: now,
            },
          },
        },
      },
    },
  });
  return {
    orderId: order.id,
    time,
    companyId: employee.companyId,
    addressId: order.addressId,
    date: todayIST(),
  };
}

/** Marks a confirmed order delivered, without walking it through the boards. */
export async function markDelivered(orderId: number) {
  const now = new Date();
  await db.order.update({
    where: { id: orderId },
    data: {
      status: 'DELIVERED',
      kitchenStartedAt: now,
      kitchenReadyAt: now,
      dispatchReadyAt: now,
      outForDeliveryAt: now,
      deliveredAt: now,
      deliveredOnTime: true,
    },
  });
}
