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
  // A unique time later today, so the drop is ours alone and still on time.
  // (Capped at 23:59 so a late-night run doesn't wrap into tomorrow.)
  const nextHour = new Date(Date.now() + 330 * 60_000).getUTCHours() + 1;
  const minute = String(Math.floor(Math.random() * 60)).padStart(2, '0');
  const time = nextHour > 23 ? '23:59' : `${String(nextHour).padStart(2, '0')}:${minute}`;
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
