import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { IdPipe } from '../id.pipe.js';
import {
  priceSchema,
  tierSchema,
  type GridRow,
  type PriceInput,
  type Tier,
  type TierGrid,
} from '@fernleaf/shared';
import type { PriceTier } from '@prisma/client';
import type { z } from 'zod';
import { Can } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';
import { pricesByTier, resolvePrice, type TierRule } from './price-rules.js';

type TierBody = z.output<typeof tierSchema>;
type Priced = {
  id: number;
  name: string;
  active: boolean;
  costPrice: number;
  prices: { tierId: number; price: number }[];
};

const toRule = (tier: PriceTier): TierRule => ({
  ...tier,
  factor: tier.factor?.toString() ?? null,
});

const gridRow = (tier: TierRule, item: Priced): GridRow => {
  const typed = pricesByTier(item.prices);
  return {
    id: item.id,
    name: item.name,
    active: item.active,
    cost: item.costPrice,
    typed: typed.get(tier.id) ?? null,
    price: resolvePrice(tier, typed, item.costPrice),
  };
};

@Controller('tiers')
export class PricingController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  @Can('catalogue.view')
  async tiers(): Promise<Tier[]> {
    const [tiers, settings, dishes] = await Promise.all([
      this.db.priceTier.findMany({ orderBy: { id: 'asc' } }),
      this.db.settings.findUniqueOrThrow({ where: { id: 1 } }),
      this.db.dish.findMany({ where: { active: true }, include: { prices: true } }),
    ]);
    return tiers.map((tier) => ({
      ...tier,
      factor: tier.factor ? Number(tier.factor) : null,
      isDefault: tier.id === settings.defaultTierId,
      missingDishes: dishes.filter((dish) => gridRow(toRule(tier), dish).price === null).length,
    }));
  }

  // The whole tier at once: every dish and option with its cost, typed price
  // and the price employees actually pay. A null price is a gap on this tier.
  @Get(':id/grid')
  @Can('catalogue.view')
  async grid(@Param('id', IdPipe) id: number): Promise<TierGrid> {
    const tier = (await this.tiers()).find((t) => t.id === id);
    if (!tier) throw new NotFoundException({ message: 'Tier not found' });
    const rule: TierRule = { ...tier, factor: tier.factor?.toString() ?? null };
    const [dishes, options] = await Promise.all([
      this.db.dish.findMany({
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        include: { prices: true },
      }),
      this.db.option.findMany({
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        include: { prices: true },
      }),
    ]);
    return {
      tier,
      dishes: dishes.map((dish) => gridRow(rule, dish)),
      options: options.map((option) => gridRow(rule, option)),
    };
  }

  @Post()
  @Can('catalogue.manage')
  async create(@Body(new ZodPipe(tierSchema)) input: TierBody) {
    await this.checkBase(null, input);
    return this.db.priceTier.create({ data: this.tierData(input) });
  }

  @Put(':id')
  @Can('catalogue.manage')
  async update(@Param('id', IdPipe) id: number, @Body(new ZodPipe(tierSchema)) input: TierBody) {
    await this.checkBase(id, input);
    return this.db.priceTier.update({ where: { id }, data: this.tierData(input) });
  }

  @Put(':id/default')
  @Can('catalogue.manage')
  async makeDefault(@Param('id', IdPipe) id: number) {
    await this.db.priceTier.findUniqueOrThrow({ where: { id } });
    await this.db.settings.update({ where: { id: 1 }, data: { defaultTierId: id } });
    return { ok: true };
  }

  // Sets one typed price (an override on a derived tier), or clears it.
  // Only affects new orders: order lines keep the price they were placed at.
  @Put(':id/prices')
  @Can('catalogue.manage')
  async setPrice(
    @Param('id', IdPipe) tierId: number,
    @Body(new ZodPipe(priceSchema)) input: PriceInput,
  ) {
    const key = input.kind === 'dish' ? { dishId: input.id } : { optionId: input.id };
    const table = (input.kind === 'dish' ? this.db.dishPrice : this.db.optionPrice) as unknown as {
      upsert(args: object): Promise<unknown>;
      deleteMany(args: object): Promise<unknown>;
    };
    if (input.price === null) {
      await table.deleteMany({ where: { tierId, ...key } });
    } else {
      const where =
        input.kind === 'dish'
          ? { tierId_dishId: { tierId, ...key } }
          : { tierId_optionId: { tierId, ...key } };
      await table.upsert({
        where,
        create: { tierId, ...key, price: input.price },
        update: { price: input.price },
      });
    }
    return { ok: true };
  }

  private tierData(input: TierBody) {
    const derived = input.base !== null;
    return {
      name: input.name,
      base: input.base,
      baseTierId: input.base === 'TIER' ? input.baseTierId : null,
      factor: derived ? input.factor : null,
    };
  }

  // One level of derivation only (D13): the base must be a typed-in tier,
  // and a tier others derive from must stay typed-in. No chains, no cycles.
  private async checkBase(id: number | null, input: TierBody) {
    if (input.base === 'TIER') {
      const base = await this.db.priceTier.findUnique({ where: { id: input.baseTierId ?? -1 } });
      if (!base || base.id === id || base.base !== null) {
        throw new BadRequestException({
          message: 'A tier can only be derived from a tier whose prices are typed in',
          fieldErrors: { baseTierId: 'Pick a typed-in tier' },
        });
      }
    }
    if (id !== null && input.base !== null) {
      const dependants = await this.db.priceTier.count({ where: { baseTierId: id } });
      if (dependants > 0) {
        throw new BadRequestException({
          message: 'Other tiers are derived from this one, so its prices must stay typed in',
          fieldErrors: { base: 'Other tiers depend on this one' },
        });
      }
    }
  }
}
