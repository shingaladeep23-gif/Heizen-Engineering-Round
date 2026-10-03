import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { createInvoiceSchema, creditSchema, type CreditInput } from '@fernleaf/shared';
import type { z } from 'zod';
import { Can } from '../auth/auth.guard.js';
import { ZodPipe } from '../zod.pipe.js';
import { BillingService } from './billing.service.js';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('companies')
  @Can('billing.view')
  companies() {
    return this.billing.companies();
  }

  @Get('companies/:id')
  @Can('billing.view')
  company(@Param('id', ParseIntPipe) id: number) {
    return this.billing.company(id);
  }

  @Post('invoices')
  @Can('billing.manage')
  create(@Body(new ZodPipe(createInvoiceSchema)) input: z.output<typeof createInvoiceSchema>) {
    return this.billing.createInvoice(input.companyId, input.orderIds, input.adjustmentIds);
  }

  @Get('invoices/:id')
  @Can('billing.view')
  invoice(@Param('id', ParseIntPipe) id: number) {
    return this.billing.invoice(id);
  }

  @Post('invoices/:id/paid')
  @HttpCode(200)
  @Can('billing.manage')
  async paid(@Param('id', ParseIntPipe) id: number) {
    await this.billing.markPaid(id);
    return { ok: true };
  }

  @Post('orders/:id/credit')
  @Can('billing.manage')
  credit(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(creditSchema)) input: CreditInput,
  ) {
    return this.billing.credit(id, input);
  }
}
