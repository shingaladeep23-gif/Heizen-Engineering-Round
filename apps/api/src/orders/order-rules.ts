// Order lines and combinations (spec 4.1). Pure, so the rules can be tested
// without a database.
import type { Choice, PricedDish } from '@fernleaf/shared';

export type LineInput = {
  dishId: number;
  quantity: number;
  combos: {
    quantity: number;
    optionIds: number[];
    sizes?: { optionId: number; sizeId: number }[];
  }[];
};

export type BuiltLine = {
  dishId: number;
  dishName: string;
  dishPrice: number;
  quantity: number;
  total: number;
  combos: { quantity: number; unitPrice: number; total: number; choices: Choice[] }[];
};

// A broken rule, with the form field it belongs to.
export class RuleError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Checks every line against the employee's menu and prices it:
 * - the dish must be on their menu (already filtered and priced for them)
 * - combination quantities add up exactly to the line quantity
 * - the minimum order quantity is met
 * - every combination satisfies every required group, within max choices,
 *   using only options the dish offers
 * - no two combinations on a line have the same choices (one prep unit each)
 * - in a group with portions, each chosen option is in one of the group's
 *   sizes (the first, if none was given)
 * Price of a combination = (dish price + chosen option prices, each with its
 * size's extra charge) x quantity.
 */
export function buildLines(menu: Map<number, PricedDish>, lines: LineInput[]) {
  const built: BuiltLine[] = [];
  const seenDishes = new Set<number>();

  lines.forEach((line, i) => {
    const field = `lines.${i}`;
    const dish = menu.get(line.dishId);
    if (!dish) throw new RuleError(field, "That dish isn't on this employee's menu");
    if (seenDishes.has(dish.id)) {
      throw new RuleError(field, `${dish.name} is on the order twice; use combinations instead`);
    }
    seenDishes.add(dish.id);

    const comboTotal = line.combos.reduce((sum, combo) => sum + combo.quantity, 0);
    if (comboTotal !== line.quantity) {
      throw new RuleError(
        `${field}.quantity`,
        `${dish.name}: the combinations add up to ${comboTotal}, but the line is for ${line.quantity}`,
      );
    }
    if (dish.minOrderQty && line.quantity < dish.minOrderQty) {
      throw new RuleError(
        `${field}.quantity`,
        `${dish.name} has a minimum order of ${dish.minOrderQty}`,
      );
    }

    const seenCombos = new Set<string>();
    const combos = line.combos.map((combo, j) => {
      const comboField = `${field}.combos.${j}`;
      const picked = new Set(combo.optionIds);
      // Sizes sent for options that weren't chosen are simply ignored.
      const sizeOf = new Map((combo.sizes ?? []).map((s) => [s.optionId, s.sizeId]));
      if (picked.size !== combo.optionIds.length) {
        throw new RuleError(comboField, `${dish.name}: the same option is chosen twice`);
      }

      const choices: Choice[] = [];
      for (const group of dish.groups) {
        const inGroup = group.options.filter((option) => picked.has(option.id));
        if (group.required && inGroup.length === 0) {
          throw new RuleError(comboField, `${dish.name}: "${group.name}" needs a choice`);
        }
        if (inGroup.length > group.maxChoices) {
          throw new RuleError(
            comboField,
            `${dish.name}: "${group.name}" allows ${group.maxChoices} at most`,
          );
        }
        for (const option of inGroup) {
          const choice: Choice = {
            groupName: group.name,
            optionId: option.id,
            optionName: option.name,
            price: option.price,
          };
          if (group.sizes.length > 0) {
            const sizeId = sizeOf.get(option.id) ?? group.sizes[0].id;
            const size = option.sizes.find((s) => s.id === sizeId);
            if (!size) {
              throw new RuleError(
                comboField,
                `${dish.name}: "${group.name}" doesn't sell ${option.name} in that size`,
              );
            }
            choice.size = size;
          } else if (sizeOf.has(option.id)) {
            throw new RuleError(comboField, `${dish.name}: ${option.name} doesn't come in sizes`);
          }
          choices.push(choice);
        }
      }
      if (choices.length !== picked.size) {
        throw new RuleError(
          comboField,
          `${dish.name}: one of the options isn't offered with this dish`,
        );
      }

      // The same options in another size are a different combination (and prep unit).
      const key = choices
        .map((c) => `${c.optionId}:${c.size?.id ?? ''}`)
        .sort()
        .join(',');
      if (seenCombos.has(key)) {
        throw new RuleError(
          comboField,
          `${dish.name}: two combinations have the same choices; merge them`,
        );
      }
      seenCombos.add(key);

      const unitPrice =
        dish.price + choices.reduce((sum, c) => sum + c.price + (c.size?.extra ?? 0), 0);
      return { quantity: combo.quantity, unitPrice, total: unitPrice * combo.quantity, choices };
    });

    built.push({
      dishId: dish.id,
      dishName: dish.name,
      dishPrice: dish.price,
      quantity: line.quantity,
      total: combos.reduce((sum, combo) => sum + combo.total, 0),
      combos,
    });
  });

  return { lines: built, total: built.reduce((sum, line) => sum + line.total, 0) };
}
