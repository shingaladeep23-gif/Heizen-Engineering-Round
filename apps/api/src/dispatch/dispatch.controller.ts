import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  assignDriverSchema,
  deliverSchema,
  stepSchema,
  type DropRef,
  type DropStep,
} from '@fernleaf/shared';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { Can, CurrentUser } from '../auth/auth.guard.js';
import { todayIST } from '../orders/calendar.js';
import { ZodPipe } from '../zod.pipe.js';
import { DispatchService } from './dispatch.service.js';

const dateQuery = new ZodPipe(z.object({ date: z.iso.date().optional() }));

@Controller()
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get('dispatch/drops')
  @Can('dispatch.view')
  drops(@Query(dateQuery) query: { date?: string }) {
    return this.dispatch.drops(query.date ?? todayIST());
  }

  @Get('dispatch/drivers')
  @Can('dispatch.view')
  drivers() {
    return this.dispatch.drivers();
  }

  @Post('dispatch/assign')
  @HttpCode(200)
  @Can('dispatch.work')
  async assign(@Body(new ZodPipe(assignDriverSchema)) input: { drop: DropRef; driverId: number }) {
    await this.dispatch.assign(input.drop, input.driverId);
    return { ok: true };
  }

  @Post('dispatch/step')
  @HttpCode(200)
  @Can('dispatch.work')
  async step(@Body(new ZodPipe(stepSchema)) input: { drop: DropRef; step: DropStep }) {
    await this.dispatch.step(input.drop, input.step, { note: '', photo: null });
    return { ok: true };
  }

  // The driver's own view: only their drops, only today (spec 4.8).
  @Get('deliveries')
  @Can('deliveries.own')
  mine(@CurrentUser() user: User) {
    return this.dispatch.drops(todayIST(), user.id);
  }

  @Post('deliveries/delivered')
  @HttpCode(200)
  @Can('deliveries.own')
  async delivered(
    @CurrentUser() user: User,
    @Body(new ZodPipe(deliverSchema)) input: z.output<typeof deliverSchema>,
  ) {
    if (input.drop.date !== todayIST()) {
      throw new BadRequestException({ message: 'Only today’s deliveries can be marked here' });
    }
    await this.dispatch.step(input.drop, 'delivered', input, user.id);
    return { ok: true };
  }
}
