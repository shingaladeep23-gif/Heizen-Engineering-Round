import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  cutoffRunSchema,
  deliveryOverrideSchema,
  ORDER_STATUSES,
  orderSchema,
  rejectSchema,
  type DeliveryOverride,
  type OrderStatus,
} from '@fernleaf/shared';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { Can, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../zod.pipe.js';
import { OrdersService } from './orders.service.js';

const listQuery = z.object({
  q: z.string().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  companyId: z.coerce.number().int().optional(),
  invoiced: z.enum(['yes', 'no']).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @Can('orders.view')
  list(@Query(new ZodPipe(listQuery)) query: z.output<typeof listQuery>) {
    return this.orders.list({
      ...query,
      status: query.status as OrderStatus | undefined,
      invoiced: query.invoiced === undefined ? undefined : query.invoiced === 'yes',
    });
  }

  @Get('delivery-info')
  @Can('orders.manage')
  deliveryInfo(
    @Query('employeeId', ParseIntPipe) employeeId: number,
    @Query(new ZodPipe(z.object({ date: z.iso.date() }).passthrough())) { date }: { date: string },
  ) {
    return this.orders.deliveryInfo(employeeId, date);
  }

  @Post('cutoff/run')
  @HttpCode(200)
  @Can('orders.override')
  runCutoff(@Body(new ZodPipe(cutoffRunSchema)) { date }: { date: string }) {
    return this.orders.runCutoff(date);
  }

  @Get(':id')
  @Can('orders.view')
  detail(@CurrentUser() user: User, @Param('id', ParseIntPipe) id: number) {
    return this.orders.detail(user, id);
  }

  @Post()
  @Can('orders.manage')
  create(
    @CurrentUser() user: User,
    @Body(new ZodPipe(orderSchema)) input: z.output<typeof orderSchema>,
  ) {
    return this.orders.save(user, null, input);
  }

  @Put(':id')
  @Can('orders.manage')
  update(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(orderSchema)) input: z.output<typeof orderSchema>,
  ) {
    return this.orders.save(user, id, input);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Can('orders.manage')
  async cancel(@CurrentUser() user: User, @Param('id', ParseIntPipe) id: number) {
    await this.orders.cancel(user, id);
    return { ok: true };
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Can('orders.override')
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(rejectSchema)) { reason }: { reason: string },
  ) {
    await this.orders.reject(id, reason);
    return { ok: true };
  }

  @Put(':id/delivery')
  @Can('orders.override')
  overrideDelivery(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(deliveryOverrideSchema)) input: DeliveryOverride,
  ) {
    return this.orders.overrideDelivery(id, input);
  }
}
