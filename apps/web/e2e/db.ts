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
 * A delivery time on `day` that no order of this company has yet, so a test's
 * drop is its own (the local database keeps every earlier run's orders).
 * Picked at random from the first hour or so of free minutes from `fromMinute`,
 * so tests running side by side rarely pick the same one.
 */
export async function freeTime(companyId: number, day: string, fromMinute = 0) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const orders = await db.order.findMany({
    where: { companyId, deliveryDate: new Date(day) },
    select: { deliveryTime: true },
  });
  const taken = new Set(orders.map((o) => o.deliveryTime));
  const free: string[] = [];
  for (let m = fromMinute; m < 24 * 60; m++) {
    const t = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    if (!taken.has(t)) free.push(t);
  }
  return free.length ? free[Math.floor(Math.random() * Math.min(free.length, 60))] : '23:59';
}

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
  // Later today, so it's still on time, and never past 23:59, so a
  // late-night run doesn't wrap into tomorrow.
  const ist = new Date(Date.now() + 330 * 60_000);
  const time = await freeTime(
    employee.companyId,
    todayIST(),
    ist.getUTCHours() * 60 + ist.getUTCMinutes() + 2,
  );
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

/**
 * A placed order on a date whose cut-off has already passed. The API (rightly)
 * won't create one, but it's what cut-off processing finds waiting for it.
 */
export async function placedPastCutoff(employeeId: number, day: string) {
  const employee = await db.employee.findUniqueOrThrow({
    where: { id: employeeId },
    include: { company: true },
  });
  const order = await db.order.create({
    data: {
      employeeId,
      companyId: employee.companyId,
      addressId: employee.company.defaultAddressId!,
      status: 'PLACED',
      deliveryDate: new Date(day),
      deliveryTime: await freeTime(employee.companyId, day),
      placedAt: new Date(),
    },
  });
  return order.id;
}
