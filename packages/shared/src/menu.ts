// What an employee sees on their menu, already filtered and priced for them.

export type PricedOption = {
  id: number;
  name: string;
  price: number;
  allergens: string[];
  dietaryTags: string[];
  warnings: string[]; // clashes with the employee's allergies
  // The group's sizes with this option's extra charge on this tier.
  sizes: { id: number; name: string; extra: number }[];
};

export type PricedGroup = {
  id: number;
  name: string;
  required: boolean;
  maxChoices: number;
  options: PricedOption[];
  sizes: { id: number; name: string }[]; // empty = no portions; the first is the default
};

export type PricedDish = {
  id: number;
  name: string;
  description: string;
  imageUrl: string | null;
  temperature: 'HOT' | 'COLD';
  minOrderQty: number | null;
  price: number;
  allergens: string[];
  dietaryTags: string[];
  groups: PricedGroup[];
  warnings: string[]; // clashes with the employee's allergies or diet
};

export type EmployeeMenu = {
  employee: { id: number; name: string; companyName: string };
  tierName: string;
  categories: { id: number; name: string; secret: boolean; dishes: PricedDish[] }[];
  // Secret categories aren't listed, but staff can open them by name.
  secretCategories: { id: number; name: string }[];
};
