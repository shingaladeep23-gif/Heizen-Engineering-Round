// Validation for catalogue, pricing and menu. Money is whole paise.
import { z } from 'zod';

const name = z.string().trim().min(1, 'Required').max(120);
const money = z.int('Must be a whole number of paise').min(0, "Can't be negative");
const ids = z.array(z.int()).default([]);

// Admin-managed reference lists (spec 4.1). Packaging is here too, same pattern.
export const LIST_KINDS = [
  'allergens',
  'dietary-tags',
  'stations',
  'packaging-types',
  'portion-sizes',
] as const;
export type ListKind = (typeof LIST_KINDS)[number];
export type ListItem = { id: number; name: string };
export type Lists = Record<ListKind, ListItem[]>;
export const listItemSchema = z.object({ name });

export const optionSchema = z.object({
  name,
  costPrice: money,
  active: z.boolean().default(true),
  allergenIds: ids,
  dietaryTagIds: ids,
  // Portions [Should]: the sizes this option comes in, each with an extra
  // charge on top of its price (the default tier's; other tiers scale it).
  sizes: z
    .array(z.object({ sizeId: z.int(), extraCharge: money }))
    .default([])
    .refine((list) => new Set(list.map((s) => s.sizeId)).size === list.length, 'Each size once'),
});
export type OptionInput = z.input<typeof optionSchema>;

export const optionGroupSchema = z
  .object({
    name,
    required: z.boolean(),
    maxChoices: z.int().min(1, 'At least 1'),
    optionIds: z.array(z.int()).min(1, 'Pick at least one option'),
    // Sizes the group sells its options in, in order; empty = no portions.
    sizeIds: z.array(z.int()).default([]),
  })
  .refine((g) => g.maxChoices <= g.optionIds.length, {
    message: "Can't allow more choices than there are options",
    path: ['maxChoices'],
  })
  .refine((g) => new Set(g.optionIds).size === g.optionIds.length, {
    message: 'Each option can only be listed once',
    path: ['optionIds'],
  })
  .refine((g) => new Set(g.sizeIds).size === g.sizeIds.length, {
    message: 'Each size can only be listed once',
    path: ['sizeIds'],
  });

export const dishSchema = z.object({
  sku: z.string().trim().min(1, 'Required').max(40),
  name,
  description: z.string().trim().max(500).default(''),
  imageUrl: z.url('Must be a full link (https://...)').nullable().default(null),
  temperature: z.enum(['HOT', 'COLD']),
  costPrice: money,
  minOrderQty: z.int().min(1, 'At least 1').nullable().default(null),
  stationId: z.int().nullable().default(null),
  active: z.boolean().default(true),
  allergenIds: ids,
  dietaryTagIds: ids,
  optionGroups: z.array(optionGroupSchema).default([]), // array order = display order
});
export type DishInput = z.input<typeof dishSchema>;

// A tier is typed in (base null) or derived: base price x factor.
export const tierSchema = z
  .object({
    name,
    base: z.enum(['COST', 'TIER']).nullable().default(null),
    baseTierId: z.int().nullable().default(null),
    factor: z.number().positive('Must be above 0').max(100).nullable().default(null),
  })
  .refine((t) => t.base === null || t.factor !== null, {
    message: 'Enter a factor, e.g. 2.4 or 1.15',
    path: ['factor'],
  })
  .refine((t) => t.base !== 'TIER' || t.baseTierId !== null, {
    message: 'Pick the tier to derive from',
    path: ['baseTierId'],
  });
export type TierInput = z.input<typeof tierSchema>;

// Set a typed price (or override). null removes it.
export const priceSchema = z.object({
  kind: z.enum(['dish', 'option']),
  id: z.int(),
  price: z.int().min(1, 'Must be above zero').nullable(),
});
export type PriceInput = z.infer<typeof priceSchema>;

export type Tier = {
  id: number;
  name: string;
  base: 'COST' | 'TIER' | null;
  baseTierId: number | null;
  factor: number | null;
  isDefault: boolean;
  missingDishes: number; // active dishes with no price on this tier
};

export type GridRow = {
  id: number;
  name: string;
  active: boolean;
  cost: number;
  typed: number | null; // typed price, or override on a derived tier
  price: number | null; // what employees pay; null = hidden from menus
};
export type TierGrid = { tier: Tier; dishes: GridRow[]; options: GridRow[] };

export const categorySchema = z.object({
  name,
  active: z.boolean().default(true),
  secret: z.boolean().default(false),
});
export type CategoryInput = z.input<typeof categorySchema>;

export const reorderSchema = z.object({ ids: z.array(z.int()).min(1) });
export const menuItemSchema = z.object({ dishId: z.int() });
export const toggleSchema = z.object({ active: z.boolean() });
