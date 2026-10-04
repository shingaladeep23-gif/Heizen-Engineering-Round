import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { GridRow, PriceInput, Tier, TierGrid, tierSchema } from '@fernleaf/shared';
import type { z } from 'zod';
import { priceDish } from '../menu/menu-rules.js';
import { PrismaService } from '../prisma.service.js';
import { pricesByTier, resolvePrice, type TierRule } from './price-rules.js';

export type TierBody = z.output<typeof tierSchema>;
type Priced = {
  id: number;
  name: string;
  active: boolean;
  costPrice: number;
  prices: { tierId: number; price: number }[];
};

// Postgres decimals come back as objects (or numbers in Tier): the rules want text.
const toRule = (tier: {
  id: number;
  base: TierRule['base'];
  baseTierId: number | null;
  factor: { toString(): string } | null;
}): TierRule => ({ ...tier, factor: tier.factor?.toString() ?? null });

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

const NO_DIET = { allergies: [], dietaryPrefs: [] };

@Injectable()
export class PricingService {
  constructor(private readonly db: PrismaService) {}

  /**
   * Every tier, with how many active dishes can't be ordered on it: no price
   * on the dish, or a required choice with no priced option left. The same
   * rule as the menu (priceDish), so the count matches what employees miss.
   */
  async tiers(): Promise<Tier[]> {
    const [tiers, settings, dishes] = await Promise.all([
      this.db.priceTier.findMany({ orderBy: { id: 'asc' } }),
      this.db.settings.findUniqueOrThrow({ where: { id: 1 } }),
      this.db.dish.findMany({
        where: { active: true },
        include: {
          allergens: true,
          dietaryTags: true,
          prices: true,
          optionGroups: {
            include: {
              sizes: { include: { size: true } },
              options: {
                include: {
                  option: {
                    include: { allergens: true, dietaryTags: true, prices: true, sizes: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);
    return tiers.map((tier) => ({
      ...tier,
      factor: tier.factor ? Number(tier.factor) : null,
      isDefault: tier.id === settings.defaultTierId,
      missingDishes: dishes.filter((dish) => priceDish(dish, toRule(tier), NO_DIET) === null)
        .length,
    }));
  }

  // The whole tier at once: every dish and option with its cost, typed price
  // and the price employees actually pay. A null price is a gap on this tier.
  async grid(id: number): Promise<TierGrid> {
    const tier = (await this.tiers()).find((t) => t.id === id);
    if (!tier) throw new NotFoundException({ message: 'Tier not found' });
    const rule = toRule(tier);
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

  async create(input: TierBody) {
    await this.checkBase(null, input);
    return this.db.priceTier.create({ data: tierData(input) });
  }

  async update(id: number, input: TierBody) {
    await this.checkBase(id, input);
    return this.db.priceTier.update({ where: { id }, data: tierData(input) });
  }

  async makeDefault(id: number) {
    await this.db.priceTier.findUniqueOrThrow({ where: { id } });
    await this.db.settings.update({ where: { id: 1 }, data: { defaultTierId: id } });
    return { ok: true };
  }

  // Sets one typed price (an override on a derived tier), or clears it.
  // Only affects new orders: order lines keep the price they were placed at.
  async setPrice(tierId: number, input: PriceInput) {
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

  // One level of derivation only: the base must be a typed-in tier,
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

function tierData(input: TierBody) {
  return {
    name: input.name,
    base: input.base,
    baseTierId: input.base === 'TIER' ? input.baseTierId : null,
    factor: input.base !== null ? input.factor : null,
  };
}
