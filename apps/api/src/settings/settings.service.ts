import { Injectable } from '@nestjs/common';
import type { settingsSchema } from '@fernleaf/shared';
import type { z } from 'zod';
import { dayOf } from '../orders/calendar.js';
import { refuseClosingBookedDays } from '../orders/closing-days.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class SettingsService {
  constructor(private readonly db: PrismaService) {}

  async get() {
    const [settings, holidays] = await Promise.all([
      this.db.settings.findUniqueOrThrow({ where: { id: 1 } }),
      this.db.kitchenHoliday.findMany({ orderBy: { date: 'asc' } }),
    ]);
    return { ...settings, holidays: holidays.map((h) => ({ date: dayOf(h.date), name: h.name })) };
  }

  // Changing the cut-off only affects dates whose cut-off hasn't been
  // processed yet; already confirmed or cancelled orders stay as they are.
  // Closing a day that already has orders is refused (refuseClosingBookedDays).
  async update({ holidays, ...values }: z.output<typeof settingsSchema>) {
    await this.db.$transaction(async (tx) => {
      const [current, currentHolidays] = await Promise.all([
        tx.settings.findUniqueOrThrow({ where: { id: 1 } }),
        tx.kitchenHoliday.findMany(),
      ]);
      await refuseClosingBookedDays(
        tx,
        {
          workingDays: current.kitchenWorkingDays,
          holidays: new Set(currentHolidays.map((h) => dayOf(h.date))),
        },
        { workingDays: values.kitchenWorkingDays, holidays: new Set(holidays.map((h) => h.date)) },
      );
      await tx.settings.update({ where: { id: 1 }, data: values });
      await tx.kitchenHoliday.deleteMany();
      await tx.kitchenHoliday.createMany({
        data: holidays.map((h) => ({ date: new Date(h.date), name: h.name })),
        skipDuplicates: true,
      });
    });
    return this.get();
  }
}
