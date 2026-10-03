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
      sizes: [],
      options: [
        {
          id: 10,
          name: 'Brown rice',
          price: 2500,
          allergens: [],
          dietaryTags: [],
          warnings: [],
          sizes: [],
        },
        {
          id: 11,
          name: 'Jeera rice',
          price: 2000,
          allergens: [],
          dietaryTags: [],
          warnings: [],
          sizes: [],
        },
      ],
    },
    {
      id: 2,
      name: 'Add-ons',
      required: false,
      maxChoices: 2,
      sizes: [],
      options: [
        {
          id: 20,
          name: 'Raita',
          price: 2000,
          allergens: [],
          dietaryTags: [],
          warnings: [],
          sizes: [],
        },
        {
          id: 21,
          name: 'Pickle',
          price: 500,
          allergens: [],
          dietaryTags: [],
          warnings: [],
          sizes: [],
        },
        {
          id: 22,
          name: 'Chutney',
          price: 800,
          allergens: [],
          dietaryTags: [],
          warnings: [],
          sizes: [],
        },
      ],
    },
  ],
};
// A protein bowl at ₹180 whose protein comes in sizes (portions, [Should]):
// paneer ₹60 (Large +₹40), tofu ₹50 (Large +₹30).
const REGULAR = { id: 1, name: 'Regular' };
const LARGE = { id: 2, name: 'Large' };
const PROTEIN_BOWL: PricedDish = {
  ...BOWL,
  id: 2,
  name: 'Protein bowl',
  price: 18000,
  groups: [
    {
      id: 3,
      name: 'Protein',
      required: true,
      maxChoices: 1,
      sizes: [REGULAR, LARGE],
      options: [
        {
          id: 30,
          name: 'Paneer',
          price: 6000,
          allergens: [],
          dietaryTags: [],
          warnings: [],
          sizes: [
            { ...REGULAR, extra: 0 },
            { ...LARGE, extra: 4000 },
          ],
        },
        {
          id: 31,
          name: 'Tofu',
          price: 5000,
          allergens: [],
          dietaryTags: [],
          warnings: [],
          sizes: [
            { ...REGULAR, extra: 0 },
            { ...LARGE, extra: 3000 },
          ],
        },
      ],
    },
  ],
};
const MENU = new Map([
  [BOWL.id, BOWL],
  [PROTEIN_BOWL.id, PROTEIN_BOWL],
]);

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
      buildLines(MENU, [{ dishId: 99, quantity: 1, combos: [{ quantity: 1, optionIds: [] }] }]),
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

  describe('portion sizes', () => {
    const line = (
      combos: {
        quantity: number;
        optionIds: number[];
        sizes?: { optionId: number; sizeId: number }[];
      }[],
    ) => [{ dishId: 2, quantity: combos.reduce((n, c) => n + c.quantity, 0), combos }];

    it("uses the group's first size when none is given, and freezes it on the line", () => {
      const { lines } = buildLines(MENU, line([{ quantity: 1, optionIds: [30] }]));
      expect(lines[0].combos[0].choices[0].size).toEqual({ id: 1, name: 'Regular', extra: 0 });
      expect(lines[0].combos[0].unitPrice).toBe(24000); // 180 + 60
    });

    it("adds the size's extra charge to the price", () => {
      const { lines } = buildLines(
        MENU,
        line([{ quantity: 2, optionIds: [30], sizes: [{ optionId: 30, sizeId: 2 }] }]),
      );
      // 2 x (180 + 60 + 40)
      expect(lines[0].combos[0].total).toBe(56000);
    });

    it('treats the same option in another size as another combination (and prep unit)', () => {
      const { lines } = buildLines(
        MENU,
        line([
          { quantity: 3, optionIds: [30] },
          { quantity: 1, optionIds: [30], sizes: [{ optionId: 30, sizeId: 2 }] },
        ]),
      );
      expect(lines[0].combos.map((c) => c.choices[0].size?.name)).toEqual(['Regular', 'Large']);
      // But the same option in the same size twice still has to be merged.
      const message = errorOf(() =>
        buildLines(
          MENU,
          line([
            { quantity: 1, optionIds: [30] },
            { quantity: 1, optionIds: [30], sizes: [{ optionId: 30, sizeId: 1 }] },
          ]),
        ),
      );
      expect(message).toMatch(/two combinations have the same choices/);
    });

    it("refuses a size the group doesn't sell, or a size where there are no sizes", () => {
      expect(
        errorOf(() =>
          buildLines(
            MENU,
            line([{ quantity: 1, optionIds: [31], sizes: [{ optionId: 31, sizeId: 9 }] }]),
          ),
        ),
      ).toMatch(/"Protein" doesn't sell Tofu in that size/);
      expect(
        errorOf(() =>
          buildLines(MENU, [
            {
              dishId: 1,
              quantity: 1,
              combos: [{ quantity: 1, optionIds: [10], sizes: [{ optionId: 10, sizeId: 2 }] }],
            },
          ]),
        ),
      ).toMatch(/Brown rice doesn't come in sizes/);
    });
  });
});
