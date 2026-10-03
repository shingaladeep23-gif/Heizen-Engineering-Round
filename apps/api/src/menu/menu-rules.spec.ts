import type { TierRule } from '../pricing/price-rules.js';
import { priceDish, type DishRow, type OptionRow } from './menu-rules.js';

const STANDARD: TierRule = {
  id: 1,
  base: null,
  baseTierId: null,
  factor: null,
};
const NO_DIET = { allergies: [], dietaryPrefs: [] };

const option = (id: number, price: number | null, extra: Partial<OptionRow> = {}): OptionRow => ({
  id,
  name: `Option ${id}`,
  active: true,
  costPrice: 100,
  allergens: [],
  dietaryTags: [],
  prices: price === null ? [] : [{ tierId: 1, price }],
  ...extra,
});

const bowl = (groups: DishRow['optionGroups'] = []): DishRow => ({
  id: 1,
  name: 'Paneer rice bowl',
  description: '',
  imageUrl: null,
  temperature: 'HOT',
  minOrderQty: null,
  costPrice: 6000,
  allergens: [{ name: 'Dairy' }],
  dietaryTags: [{ name: 'Vegetarian' }],
  prices: [{ tierId: 1, price: 18000 }],
  optionGroups: groups,
});

const group = (required: boolean, options: OptionRow[], maxChoices = 1) => ({
  id: 10,
  name: 'Choose your rice',
  required,
  maxChoices,
  options: options.map((o) => ({ option: o })),
});

describe('priceDish', () => {
  it('prices a dish and its options on the tier', () => {
    const dish = priceDish(
      bowl([group(true, [option(1, 1500), option(2, 2000)])]),
      STANDARD,
      NO_DIET,
    );
    expect(dish?.price).toBe(18000);
    expect(dish?.groups[0].options.map((o) => o.price)).toEqual([1500, 2000]);
  });

  it('warns about an option that clashes with an allergy, not just the dish', () => {
    const dish = priceDish(
      bowl([group(true, [option(1, 1500, { allergens: [{ name: 'Nuts' }] }), option(2, 1500)])]),
      STANDARD,
      { allergies: ['Nuts'], dietaryPrefs: [] },
    );
    expect(dish?.warnings).toEqual([]); // the bowl itself has no nuts
    expect(dish?.groups[0].options.map((o) => o.warnings)).toEqual([['Contains Nuts'], []]);
  });

  it('hides a dish with no price on the tier', () => {
    expect(priceDish({ ...bowl(), prices: [] }, STANDARD, NO_DIET)).toBeNull();
  });

  it('drops options that are inactive or unpriced', () => {
    const dish = priceDish(
      bowl([group(true, [option(1, 1500), option(2, null), option(3, 900, { active: false })])]),
      STANDARD,
      NO_DIET,
    );
    expect(dish?.groups[0].options.map((o) => o.id)).toEqual([1]);
  });

  it('hides the dish when a required group has nothing left to choose', () => {
    expect(priceDish(bowl([group(true, [option(1, null)])]), STANDARD, NO_DIET)).toBeNull();
  });

  it('just drops an optional group that has nothing left', () => {
    const dish = priceDish(bowl([group(false, [option(1, null)])]), STANDARD, NO_DIET);
    expect(dish?.groups).toEqual([]);
  });

  it('caps max choices at the number of options actually available', () => {
    const dish = priceDish(
      bowl([group(false, [option(1, 500), option(2, null)], 3)]),
      STANDARD,
      NO_DIET,
    );
    expect(dish?.groups[0].maxChoices).toBe(1);
  });

  it("warns about the employee's allergies and diet but still shows the dish", () => {
    const dish = priceDish(bowl(), STANDARD, {
      allergies: ['Dairy'],
      dietaryPrefs: ['Vegan'],
    });
    expect(dish?.warnings).toEqual(['Contains Dairy', 'Not marked Vegan']);
  });
});
