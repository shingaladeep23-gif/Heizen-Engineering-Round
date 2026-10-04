import { Body, Controller, Get, Put } from '@nestjs/common';
import { settingsSchema } from '@fernleaf/shared';
import type { z } from 'zod';
import { Can } from '../auth/auth.guard.js';
import { ZodPipe } from '../zod.pipe.js';
import { SettingsService } from './settings.service.js';

// Platform-wide values (spec 4.10), so nobody has to edit code or the database.
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Can('settings.manage')
  get() {
    return this.settings.get();
  }

  @Put()
  @Can('settings.manage')
  update(@Body(new ZodPipe(settingsSchema)) input: z.output<typeof settingsSchema>) {
    return this.settings.update(input);
  }
}
