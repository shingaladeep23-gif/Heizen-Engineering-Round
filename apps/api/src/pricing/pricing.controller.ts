import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { priceSchema, tierSchema, type PriceInput } from '@fernleaf/shared';
import { Can } from '../auth/auth.guard.js';
import { IdPipe } from '../id.pipe.js';
import { ZodPipe } from '../zod.pipe.js';
import { PricingService, type TierBody } from './pricing.service.js';

@Controller('tiers')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  @Can('catalogue.view')
  tiers() {
    return this.pricing.tiers();
  }

  @Get(':id/grid')
  @Can('catalogue.view')
  grid(@Param('id', IdPipe) id: number) {
    return this.pricing.grid(id);
  }

  @Post()
  @Can('catalogue.manage')
  create(@Body(new ZodPipe(tierSchema)) input: TierBody) {
    return this.pricing.create(input);
  }

  @Put(':id')
  @Can('catalogue.manage')
  update(@Param('id', IdPipe) id: number, @Body(new ZodPipe(tierSchema)) input: TierBody) {
    return this.pricing.update(id, input);
  }

  @Put(':id/default')
  @Can('catalogue.manage')
  makeDefault(@Param('id', IdPipe) id: number) {
    return this.pricing.makeDefault(id);
  }

  @Put(':id/prices')
  @Can('catalogue.manage')
  setPrice(@Param('id', IdPipe) tierId: number, @Body(new ZodPipe(priceSchema)) input: PriceInput) {
    return this.pricing.setPrice(tierId, input);
  }
}
