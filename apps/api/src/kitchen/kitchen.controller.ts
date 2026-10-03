import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { IdPipe } from '../id.pipe.js';
import { z } from 'zod';
import { Can } from '../auth/auth.guard.js';
import { todayIST } from '../orders/calendar.js';
import { ZodPipe } from '../zod.pipe.js';
import { KitchenService } from './kitchen.service.js';

@Controller('kitchen')
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get()
  @Can('kitchen.view')
  board(@Query(new ZodPipe(z.object({ date: z.iso.date().optional() }))) query: { date?: string }) {
    return this.kitchen.board(query.date ?? todayIST());
  }

  @Post('units/:id/start')
  @HttpCode(200)
  @Can('kitchen.work')
  async start(@Param('id', IdPipe) id: number) {
    await this.kitchen.mark(id, 'start');
    return { ok: true };
  }

  @Post('units/:id/done')
  @HttpCode(200)
  @Can('kitchen.work')
  async done(@Param('id', IdPipe) id: number) {
    await this.kitchen.mark(id, 'done');
    return { ok: true };
  }

  @Post('orders/:id/complete')
  @HttpCode(200)
  @Can('orders.override')
  async complete(@Param('id', IdPipe) id: number) {
    await this.kitchen.forceComplete(id);
    return { ok: true };
  }
}
