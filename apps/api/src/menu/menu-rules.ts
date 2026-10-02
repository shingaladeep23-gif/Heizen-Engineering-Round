// Turns catalogue rows into what one employee can actually order (spec 4.2, 4.3).
import type { PricedDish, PricedOption } from '@fernleaf/shared';
import { pricesByTier, resolvePrice, type TierRule } from '../pricing/price-rules.js';

type Named = { name: string };
type Prices = { tierId: number; price: number }[];

export type OptionRow = {
  id: number;
  name: string;
  active: boolean;
  costPrice: number;
  allergens: Named[];
  dietaryTags: Named[];
  prices: Prices;
};

export type DishRow = {
  id: number;
  name: string;
  description: string;
  imageUrl: string | null;
  temperature: 'HOT' | 'COLD';
  minOrderQty: number | null;
  costPrice: number;
  allergens: Named[];
  dietaryTags: Named[];
  prices: Prices;
  optionGroups: {
    id: number;
    name: string;
    required: boolean;
    maxChoices: number;
    options: { option: OptionRow }[];
  }[];
};

export type Diet = { allergies: string[]; dietaryPrefs: string[] };

const names = (rows: Named[]) => rows.map((row) => row.name);

/** Null means the dish can't be ordered on this tier, so it's left off the menu. */
export function priceDish(dish: DishRow, tier: TierRule, diet: Diet): PricedDish | null {
  const price = resolvePrice(tier, pricesByTier(dish.prices), dish.costPrice);
  if (price === null) return null;

  const groups = [];
  for (const group of dish.optionGroups) {
    const options: PricedOption[] = [];
    for (const { option } of group.options) {
      const optionPrice = resolvePrice(tier, pricesByTier(option.prices), option.costPrice);
      if (!option.active || optionPrice === null) continue;
      options.push({
        id: option.id,
        name: option.name,
        price: optionPrice,
        allergens: names(option.allergens),
        dietaryTags: names(option.dietaryTags),
      });
    }
    // A required choice with nothing left to choose makes the dish unorderable.
    if (options.length === 0) {
      if (group.required) return null;
      continue;
    }
    const maxChoices = Math.min(group.maxChoices, options.length);
    groups.push({
      id: group.id,
      name: group.name,
      required: group.required,
      maxChoices,
      options,
    });
  }

  const allergens = names(dish.allergens);
  const dietaryTags = names(dish.dietaryTags);
  const warnings = [
    ...allergens.filter((a) => diet.allergies.includes(a)).map((a) => `Contains ${a}`),
    ...diet.dietaryPrefs.filter((d) => !dietaryTags.includes(d)).map((d) => `Not marked ${d}`),
  ];

  return {
    id: dish.id,
    name: dish.name,
    description: dish.description,
    imageUrl: dish.imageUrl,
    temperature: dish.temperature,
    minOrderQty: dish.minOrderQty,
    price,
    allergens,
    dietaryTags,
    groups,
    warnings,
  };
}
