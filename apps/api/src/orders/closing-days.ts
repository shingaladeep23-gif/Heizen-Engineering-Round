import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { dayLabel, dayOf, isOpen, todayIST, type Calendar } from './calendar.js';

/**
 * Refuses a calendar change that would close a day (a new holiday, or a
 * working day taken away) on which orders are already booked: drafts,
 * placed or confirmed, from today on. Otherwise those orders would sit on a
 * day nobody cooks or receives them. Days that were already closed don't
 * count; only the ones this change closes. `companyId` limits it to one
 * company's orders (its own calendar); without it, it's the kitchen's.
 */
export async function refuseClosingBookedDays(
  db: Prisma.TransactionClient,
  before: Calendar,
  after: Calendar,
  companyId?: number,
) {
  const booked = await db.order.groupBy({
    by: ['deliveryDate'],
    where: {
      companyId,
      deliveryDate: { gte: new Date(todayIST()) },
      status: { in: ['DRAFT', 'PLACED', 'CONFIRMED'] },
    },
    _count: true,
    orderBy: { deliveryDate: 'asc' },
  });
  const closing = booked.filter((b) => {
    const day = dayOf(b.deliveryDate);
    return isOpen(before, day) && !isOpen(after, day);
  });
  if (closing.length > 0) {
    const list = closing
      .map((b) => `${dayLabel(dayOf(b.deliveryDate))} (${b._count} orders)`)
      .join(', ');
    throw new ConflictException({
      message: `Orders are already booked for ${list}. Cancel or move them before closing that day.`,
    });
  }
}
