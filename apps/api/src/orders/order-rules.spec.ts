import type { PricedDish } from '@fernleaf/shared';
import { buildLines, RuleError } from './order-rules.js';

// "Paneer rice bowl" at ₹200: pick a rice (required), up to 2 add-ons (optional).
const BOWL: PricedDish = {
  id: 1,
  name: 'Paneer rice bowl',
  description: '',
  imageUrl: null,
  temperature: 'HOT',
  minOrderQty: null,
  price: 20000,
  allergens: [],
  dietaryTags: [],
  warnings: [],
  groups: [
    {
      id: 1,
      name: 'Rice',
      required: true,
      maxChoices: 1,
      options: [
        { id: 10, name: 'Brown rice', price: 2500, allergens: [], dietaryTags: [] },
        { id: 11, name: 'Jeera rice', price: 2000, allergens: [], dietaryTags: [] },
      ],
    },
    {
      id: 2,
      name: 'Add-ons',
      required: false,
      maxChoices: 2,
      options: [
        { id: 20, name: 'Raita', price: 2000, allergens: [], dietaryTags: [] },
        { id: 21, name: 'Pickle', price: 500, allergens: [], dietaryTags: [] },
        { id: 22, name: 'Chutney', price: 800, allergens: [], dietaryTags: [] },
      ],
    },
  ],
};
const MENU = new Map([[BOWL.id, BOWL]]);

const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof RuleError) return error.message;
    throw error;
  }
  return null;
};

describe('buildLines', () => {
  it('prices the spec example: 10 bowls, 6 with brown rice and 4 with jeera rice', () => {
    const { lines, total } = buildLines(MENU, [
      {
        dishId: 1,
        quantity: 10,
        combos: [
          { quantity: 6, optionIds: [10] },
          { quantity: 4, optionIds: [11, 20] },
        ],
      },
    ]);
    // 6 x (200 + 25) = 1350, 4 x (200 + 20 + 20) = 960
    expect(lines[0].combos.map((c) => c.total)).toEqual([135000, 96000]);
    expect(lines[0].total).toBe(231000);
    expect(total).toBe(231000);
    expect(lines[0].combos[1].choices.map((c) => c.optionName)).toEqual(['Jeera rice', 'Raita']);
  });

  it('rejects combinations that do not add up to the dish quantity', () => {
    const message = errorOf(() =>
      buildLines(MENU, [{ dishId: 1, quantity: 10, combos: [{ quantity: 6, optionIds: [10] }] }]),
    );
    expect(message).toMatch(/add up to 6, but the line is for 10/);
  });

  it('rejects a combination that skips a required group', () => {
    const message = errorOf(() =>
      buildLines(MENU, [{ dishId: 1, quantity: 1, combos: [{ quantity: 1, optionIds: [20] }] }]),
    );
    expect(message).toMatch(/"Rice" needs a choice/);
  });

  it('rejects too many choices in a group', () => {
    const message = errorOf(() =>
      buildLines(MENU, [
        { dishId: 1, quantity: 1, combos: [{ quantity: 1, optionIds: [10, 11] }] },
      ]),
    );
    expect(message).toMatch(/allows 1 at most/);
  });

  it("rejects an option the dish doesn't offer", () => {
    const message = errorOf(() =>
      buildLines(MENU, [
        { dishId: 1, quantity: 1, combos: [{ quantity: 1, optionIds: [10, 99] }] },
      ]),
    );
    expect(message).toMatch(/isn't offered/);
  });

  it('rejects two combinations with the same choices, in any order', () => {
    const message = errorOf(() =>
      buildLines(MENU, [
        {
          dishId: 1,
          quantity: 2,
          combos: [
            { quantity: 1, optionIds: [10, 20] },
            { quantity: 1, optionIds: [20, 10] },
          ],
        },
      ]),
    );
    expect(message).toMatch(/same choices/);
  });

  it("rejects a dish that isn't on the employee's menu", () => {
    const message = errorOf(() =>
      buildLines(MENU, [{ dishId: 2, quantity: 1, combos: [{ quantity: 1, optionIds: [] }] }]),
    );
    expect(message).toMatch(/isn't on this employee's menu/);
  });

  it('enforces the minimum order quantity per line', () => {
    const menu = new Map([[1, { ...BOWL, minOrderQty: 5 }]]);
    const message = errorOf(() =>
      buildLines(menu, [{ dishId: 1, quantity: 4, combos: [{ quantity: 4, optionIds: [10] }] }]),
    );
    expect(message).toMatch(/minimum order of 5/);
  });
});
