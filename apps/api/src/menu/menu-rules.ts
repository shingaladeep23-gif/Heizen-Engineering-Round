// Turns catalogue rows into what one employee can actually order (spec 4.2, 4.3).
import type { PricedDish, PricedOption } from '@fernleaf/shared';
import { pricesByTier, resolvePrice, scaleExtra, type TierRule } from '../pricing/price-rules.js';

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
  sizes?: { sizeId: number; extraCharge: number }[]; // portion sizes it comes in
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
    sizes?: { size: { id: number; name: string } }[]; // in display order; none = no portions
  }[];
};

export type Diet = { allergies: string[]; dietaryPrefs: string[] };

const names = (rows: Named[]) => rows.map((row) => row.name);

/**
 * Null means the dish can't be ordered on this tier, so it's left off the menu.
 * `defaultTier` is only needed for portion sizes, whose extra charges scale
 * from the default tier's price (see
 * scaleExtra in price-rules.ts).
 */
export function priceDish(
  dish: DishRow,
  tier: TierRule,
  diet: Diet,
  defaultTier: TierRule | null = null,
): PricedDish | null {
  const price = resolvePrice(tier, pricesByTier(dish.prices), dish.costPrice);
  if (price === null) return null;

  const groups = [];
  for (const group of dish.optionGroups) {
    const groupSizes = (group.sizes ?? []).map((s) => s.size);
    const options: PricedOption[] = [];
    for (const { option } of group.options) {
      const typed = pricesByTier(option.prices);
      const optionPrice = resolvePrice(tier, typed, option.costPrice);
      if (!option.active || optionPrice === null) continue;
      // In a group with portions, an option is only sold if it comes in every size.
      const extras = new Map((option.sizes ?? []).map((s) => [s.sizeId, s.extraCharge]));
      if (groupSizes.some((size) => !extras.has(size.id))) continue;
      const defaultPrice = defaultTier ? resolvePrice(defaultTier, typed, option.costPrice) : null;
      const allergens = names(option.allergens);
      options.push({
        id: option.id,
        name: option.name,
        price: optionPrice,
        allergens,
        dietaryTags: names(option.dietaryTags),
        // Allergies only: most options carry no diet tags, so "not marked
        // Vegan" on each of them would just be noise.
        warnings: allergens.filter((a) => diet.allergies.includes(a)).map((a) => `Contains ${a}`),
        sizes: groupSizes.map((size) => ({
          ...size,
          extra: scaleExtra(extras.get(size.id)!, optionPrice, defaultPrice),
        })),
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
      sizes: groupSizes,
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
