import { Injectable } from '@nestjs/common';
import type { Tier } from '@fernleaf/shared';
import type { PriceTier } from '@prisma/client';
import { priceDish } from '../menu/menu-rules.js';
import { PrismaService } from '../prisma.service.js';
import type { TierRule } from './price-rules.js';

export const toRule = (tier: PriceTier): TierRule => ({
  ...tier,
  factor: tier.factor?.toString() ?? null,
});

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
}
