import { Body, Controller, Get, Put } from '@nestjs/common';
import { settingsSchema } from '@fernleaf/shared';
import type { z } from 'zod';
import { Can } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma.service.js';
import { dayOf } from '../orders/calendar.js';
import { ZodPipe } from '../zod.pipe.js';

// Platform-wide values (spec 4.10), so nobody has to edit code or the database.
@Controller('settings')
export class SettingsController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  @Can('settings.manage')
  async get() {
    const [settings, holidays] = await Promise.all([
      this.db.settings.findUniqueOrThrow({ where: { id: 1 } }),
      this.db.kitchenHoliday.findMany({ orderBy: { date: 'asc' } }),
    ]);
    return { ...settings, holidays: holidays.map((h) => ({ date: dayOf(h.date), name: h.name })) };
  }

  // Changing the cut-off only affects dates whose cut-off hasn't been
  // processed yet; already confirmed or cancelled orders stay as they are.
  @Put()
  @Can('settings.manage')
  async update(
    @Body(new ZodPipe(settingsSchema)) { holidays, ...values }: z.output<typeof settingsSchema>,
  ) {
    await this.db.$transaction([
      this.db.settings.update({ where: { id: 1 }, data: values }),
      this.db.kitchenHoliday.deleteMany(),
      this.db.kitchenHoliday.createMany({
        data: holidays.map((h) => ({ date: new Date(h.date), name: h.name })),
        skipDuplicates: true,
      }),
    ]);
    return this.get();
  }
}
