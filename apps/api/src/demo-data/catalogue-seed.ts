// Demo catalogue, price tiers, menu, companies and employees.
// Only runs on an empty database (see DemoDataService). Money is in paise.
import type { PrismaClient } from '@prisma/client';

const STATIONS = ['Tandoor', 'Curry', 'Rice & Grains', 'Cold Kitchen', 'Breakfast'];
const ALLERGENS = ['Gluten', 'Dairy', 'Nuts', 'Peanuts', 'Soy', 'Sesame', 'Mustard', 'Egg'];
const DIETARY_TAGS = ['Vegetarian', 'Vegan', 'Jain', 'Gluten-free', 'High protein'];
const PACKAGING = ['Standard box', 'Eco bagasse box', 'Individually labelled'];

// name, cost, Standard price, allergens, dietary tags
const OPTIONS: [string, number, number, string[], string[]][] = [
  ['Paneer', 3000, 6000, ['Dairy'], ['Vegetarian', 'Jain', 'Gluten-free']],
  ['Tofu', 2500, 5000, ['Soy'], ['Vegan', 'Vegetarian', 'Jain', 'Gluten-free']],
  ['Chickpeas', 1200, 3000, [], ['Vegan', 'Vegetarian', 'Gluten-free']],
  ['Chicken tikka', 4000, 8000, ['Dairy'], ['Gluten-free', 'High protein']],
  ['Jeera rice', 1000, 2000, [], ['Vegan', 'Vegetarian', 'Jain', 'Gluten-free']],
  ['Brown rice', 1200, 2500, [], ['Vegan', 'Vegetarian', 'Jain', 'Gluten-free']],
  ['Butter naan', 800, 2000, ['Gluten', 'Dairy'], ['Vegetarian']],
  ['Tandoori roti', 500, 1500, ['Gluten'], ['Vegan', 'Vegetarian']],
  ['Raita', 700, 2000, ['Dairy'], ['Vegetarian', 'Gluten-free']],
  ['Mint chutney', 200, 800, [], ['Vegan', 'Vegetarian', 'Jain', 'Gluten-free']],
  ['Coconut chutney', 400, 1000, [], ['Vegan', 'Vegetarian', 'Jain', 'Gluten-free']],
  ['Mango pickle', 200, 500, ['Mustard'], ['Vegan', 'Vegetarian', 'Gluten-free']],
  ['Gulab jamun', 1200, 3500, ['Dairy', 'Gluten'], ['Vegetarian']],
  ['Masala chaas', 1000, 3000, ['Dairy'], ['Vegetarian', 'Gluten-free']],
];

type Group = [name: string, required: boolean, maxChoices: number, options: string[]];
const RICE: Group = ['Choose your rice', true, 1, ['Jeera rice', 'Brown rice']];
const ADD_ONS: Group = ['Add-ons', false, 2, ['Raita', 'Mint chutney', 'Mango pickle']];
const BREAD: Group = ['Choose your bread', true, 1, ['Butter naan', 'Tandoori roti']];
const PROTEIN: Group = ['Choose your protein', true, 1, ['Paneer', 'Tofu', 'Chickpeas']];

type DishSeed = {
  sku: string;
  name: string;
  description: string;
  temperature: 'HOT' | 'COLD';
  station: string | null;
  cost: number;
  price: number; // Standard tier
  minOrderQty?: number;
  allergens: string[];
  tags: string[];
  groups: Group[];
  active?: boolean;
};

const DISHES: Record<string, DishSeed[]> = {
  Bowls: [
    {
      sku: 'FL-BWL-001',
      name: 'Paneer Tikka Rice Bowl',
      description: 'Smoky tandoor paneer tikka over rice, with pickled onions and greens.',
      temperature: 'HOT',
      station: 'Tandoor',
      cost: 6500,
      price: 22000,
      allergens: ['Dairy'],
      tags: ['Vegetarian', 'Gluten-free'],
      groups: [RICE, ADD_ONS],
    },
    {
      sku: 'FL-BWL-002',
      name: 'Build-your-own Protein Bowl',
      description: 'Roasted seasonal veg and greens with the protein and base you pick.',
      temperature: 'HOT',
      station: 'Rice & Grains',
      cost: 5000,
      price: 20000,
      allergens: [],
      tags: ['Gluten-free', 'High protein'],
      groups: [
        ['Choose your protein', true, 1, ['Paneer', 'Tofu', 'Chickpeas', 'Chicken tikka']],
        RICE,
        ADD_ONS,
      ],
    },
    {
      sku: 'FL-BWL-003',
      name: 'Rajma Chawal Bowl',
      description: 'Slow-cooked kidney bean curry, the Punjabi way.',
      temperature: 'HOT',
      station: 'Curry',
      cost: 4000,
      price: 16000,
      allergens: [],
      tags: ['Vegan', 'Vegetarian', 'Gluten-free'],
      groups: [RICE, ADD_ONS],
    },
  ],
  'Thalis & Mains': [
    {
      sku: 'FL-MNS-001',
      name: 'Dal Makhani Thali',
      description: 'Dal makhani, seasonal sabzi, salad, jeera rice and bread.',
      temperature: 'HOT',
      station: 'Curry',
      cost: 7500,
      price: 26000,
      allergens: ['Dairy'],
      tags: ['Vegetarian'],
      groups: [
        BREAD,
        ['Something sweet', false, 1, ['Gulab jamun']],
        ['Drink', false, 1, ['Masala chaas']],
      ],
    },
    {
      sku: 'FL-MNS-002',
      name: 'Chicken Curry Thali',
      description: 'Home-style chicken curry, dal, salad, rice and bread.',
      temperature: 'HOT',
      station: 'Curry',
      cost: 9500,
      price: 32000,
      allergens: ['Dairy'],
      tags: ['High protein'],
      groups: [BREAD],
    },
    {
      sku: 'FL-MNS-003',
      name: 'Jain Veg Pulao',
      description: 'Fragrant pulao made without onion, garlic or root vegetables.',
      temperature: 'HOT',
      station: 'Rice & Grains',
      cost: 4500,
      price: 17000,
      allergens: [],
      tags: ['Vegetarian', 'Jain', 'Gluten-free'],
      groups: [['Add-ons', false, 1, ['Raita', 'Mint chutney']]],
    },
  ],
  Breakfast: [
    {
      sku: 'FL-BRK-001',
      name: 'Masala Poha',
      description: 'Flattened rice with curry leaves, peanuts and a squeeze of lime.',
      temperature: 'HOT',
      station: 'Breakfast',
      cost: 2000,
      price: 9000,
      minOrderQty: 5,
      allergens: ['Peanuts'],
      tags: ['Vegan', 'Vegetarian', 'Gluten-free'],
      groups: [],
    },
    {
      sku: 'FL-BRK-002',
      name: 'Idli Sambar (3 pcs)',
      description: 'Steamed rice cakes with sambar.',
      temperature: 'HOT',
      station: 'Breakfast',
      cost: 2200,
      price: 9500,
      allergens: [],
      tags: ['Vegan', 'Vegetarian', 'Gluten-free'],
      groups: [['Choose your chutney', true, 1, ['Coconut chutney', 'Mint chutney']]],
    },
    {
      sku: 'FL-BRK-003',
      name: 'Overnight Oats with Fruit',
      description: 'Oats soaked in milk with seasonal fruit, honey and almonds.',
      temperature: 'COLD',
      station: 'Cold Kitchen',
      cost: 3000,
      price: 12000,
      allergens: ['Dairy', 'Nuts', 'Gluten'],
      tags: ['Vegetarian'],
      groups: [],
    },
  ],
  'Salads & Wraps': [
    {
      sku: 'FL-SLD-001',
      name: 'Quinoa Power Salad',
      description: 'Quinoa, cucumber, pomegranate and lemon dressing, with a protein.',
      temperature: 'COLD',
      station: 'Cold Kitchen',
      cost: 5500,
      price: 21000,
      allergens: [],
      tags: ['Vegetarian', 'Gluten-free', 'High protein'],
      groups: [PROTEIN],
    },
    {
      sku: 'FL-SLD-002',
      name: 'Chicken Tikka Wrap',
      description: 'Chicken tikka, onions and mint mayo in a whole-wheat wrap.',
      temperature: 'HOT',
      station: 'Tandoor',
      cost: 6000,
      price: 21000,
      allergens: ['Gluten', 'Dairy', 'Egg'],
      tags: ['High protein'],
      groups: [ADD_ONS],
    },
  ],
  Desserts: [
    {
      sku: 'FL-DST-001',
      name: 'Gulab Jamun (2 pcs)',
      description: 'Warm, syrupy and exactly what you think it is.',
      temperature: 'HOT',
      station: null, // shows up as "Unassigned" on the kitchen board
      cost: 1500,
      price: 6000,
      allergens: ['Dairy', 'Gluten'],
      tags: ['Vegetarian'],
      groups: [],
    },
    {
      sku: 'FL-DST-002',
      name: 'Mango Shrikhand',
      description: 'Hung curd sweetened with Alphonso mango and topped with pistachio.',
      temperature: 'COLD',
      station: 'Cold Kitchen',
      cost: 2500,
      price: 9000,
      allergens: ['Dairy', 'Nuts'],
      tags: ['Vegetarian', 'Gluten-free'],
      groups: [],
    },
    {
      sku: 'FL-DST-003',
      name: 'Ragi Brownie',
      description: 'Finger-millet brownie. Retired after the summer menu.',
      temperature: 'COLD',
      station: 'Cold Kitchen',
      cost: 2000,
      price: 8000,
      allergens: ['Dairy', 'Nuts'],
      tags: ['Vegetarian'],
      groups: [],
      active: false,
    },
  ],
  "Chef's Specials": [
    {
      sku: 'FL-SPC-001',
      name: 'Hyderabadi Dum Biryani',
      description: 'Our weekend special, for team lunches only.',
      temperature: 'HOT',
      station: 'Rice & Grains',
      cost: 11000,
      price: 38000,
      minOrderQty: 10,
      allergens: ['Dairy', 'Nuts'],
      tags: [],
      groups: [['Add-ons', false, 1, ['Raita']]],
    },
  ],
};

// Dish photos from Wikimedia Commons (openly licensed). Jain Veg Pulao has none:
// the only pulao photo has meat in it, which would be wrong for that dish.
const COMMONS = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/';
const IMAGES: Record<string, string> = {
  'FL-BWL-001': `${COMMONS}f/f2/Paneer_tikka.jpg/330px-Paneer_tikka.jpg`,
  'FL-BWL-002': `${COMMONS}5/53/BuddhaBowlLot.jpg/330px-BuddhaBowlLot.jpg`,
  'FL-BWL-003': `${COMMONS}3/37/Rajma_Masala_%2832081557778%29.jpg/330px-Rajma_Masala_%2832081557778%29.jpg`,
  'FL-MNS-001': `${COMMONS}4/49/Vegetarian_Curry.jpeg/330px-Vegetarian_Curry.jpeg`,
  'FL-MNS-002': `${COMMONS}4/41/Butter_Chicken_%26_Butter_Naan_-_Home_-_Chandigarh_-_India_-_0006.jpg/330px-Butter_Chicken_%26_Butter_Naan_-_Home_-_Chandigarh_-_India_-_0006.jpg`,
  'FL-BRK-001': `${COMMONS}8/80/Poha.jpg/330px-Poha.jpg`,
  'FL-BRK-002': `${COMMONS}1/11/Idli_Sambar.JPG/330px-Idli_Sambar.JPG`,
  'FL-BRK-003': `${COMMONS}d/da/Dorset_Cereals_muesli.jpg/330px-Dorset_Cereals_muesli.jpg`,
  'FL-SLD-001': `${COMMONS}a/ac/Tabouleh_1.JPG/330px-Tabouleh_1.JPG`,
  'FL-SLD-002': `${COMMONS}f/fc/Kolkata_Rolls.jpg/330px-Kolkata_Rolls.jpg`,
  'FL-DST-001': `${COMMONS}c/c1/Gulab-jamun-wallpaper-1.jpg/330px-Gulab-jamun-wallpaper-1.jpg`,
  'FL-DST-002': `${COMMONS}5/5c/Shrikhand_london_kastoori.jpg/330px-Shrikhand_london_kastoori.jpg`,
  'FL-DST-003': `${COMMONS}6/68/Chocolatebrownie.JPG/330px-Chocolatebrownie.JPG`,
  'FL-SPC-001': `${COMMONS}7/7c/Hyderabadi_Chicken_Biryani.jpg/330px-Hyderabadi_Chicken_Biryani.jpg`,
};

const SECRET_CATEGORIES = ["Chef's Specials"];
// Startup tier only prices the cheaper dishes, so its menu is visibly smaller.
const STARTUP_SKUS = [
  'FL-BWL-001',
  'FL-BWL-002',
  'FL-BWL-003',
  'FL-BRK-001',
  'FL-BRK-002',
  'FL-BRK-003',
  'FL-DST-001',
  'FL-DST-002',
];

type EmployeeSeed = [name: string, allergies: string[], diet: string[], flags?: 'address' | 'all'];
type CompanySeed = {
  name: string;
  domains: string[];
  tier: 'Enterprise' | 'Partner' | 'Startup' | null;
  addresses: [label: string, text: string][];
  deliveryTime: string;
  dispatchLeadMinutes?: number;
  workingDays?: number[];
  packaging: string;
  instructions: string;
  hiddenCategories?: string[];
  hiddenDishes?: string[];
  holidays?: [date: string, name: string][];
  employees: EmployeeSeed[];
};

const COMPANIES: CompanySeed[] = [
  {
    name: 'Acme Analytics',
    domains: ['acmeanalytics.in'],
    tier: 'Enterprise',
    addresses: [
      [
        'HQ, 4th floor',
        'Prestige Tech Park, Marathahalli-Sarjapur Outer Ring Rd, Bengaluru 560103',
      ],
      ['Whitefield office', 'ITPL Main Rd, Whitefield, Bengaluru 560066'],
    ],
    deliveryTime: '12:30',
    packaging: 'Standard box',
    instructions: 'Hand over at reception, ask for the pantry team.',
    holidays: [['2026-10-20', 'Dussehra']],
    employees: [
      ['Priya Raman', [], ['Vegetarian'], 'all'],
      ['Arjun Mehta', ['Peanuts'], [], 'address'],
      ['Sneha Kulkarni', [], ['Vegan']],
      ['Rahul Nair', [], []],
      ['Fatima Sheikh', ['Dairy'], []],
      ['Vikram Rao', [], ['High protein']],
      ['Ananya Iyer', [], ['Vegetarian']],
      ['Karthik Subramanian', ['Gluten'], []],
    ],
  },
  {
    name: 'Bluepeak Software',
    domains: ['bluepeak.io', 'bluepeak.co.in'],
    tier: null, // default tier
    addresses: [['Koramangala office', '80 Feet Rd, Koramangala 4th Block, Bengaluru 560034']],
    deliveryTime: '13:00',
    workingDays: [1, 2, 3, 4, 5, 6],
    packaging: 'Eco bagasse box',
    instructions: 'Use the service lift. Security needs the order number.',
    employees: [
      ['Rohan Desai', [], [], 'all'],
      ['Meera Joshi', [], ['Jain']],
      ['Aditya Kumar', ['Nuts'], []],
      ['Divya Menon', [], ['Vegetarian']],
      ['Siddharth Bose', [], []],
      ['Neha Agarwal', ['Soy'], ['Vegetarian']],
    ],
  },
  {
    name: 'Kaveri Consulting',
    domains: ['kaveri.co.in'],
    tier: 'Partner',
    addresses: [
      ['Indiranagar office', '100 Feet Rd, HAL 2nd Stage, Indiranagar, Bengaluru 560038'],
    ],
    deliveryTime: '12:00',
    packaging: 'Individually labelled',
    instructions: 'Vegetarian office. Leave boxes in the 2nd floor cafeteria.',
    hiddenDishes: ['Chicken Curry Thali', 'Chicken Tikka Wrap'],
    employees: [
      ['Lakshmi Venkatesh', [], ['Vegetarian'], 'all'],
      ['Harish Gowda', [], ['Vegetarian']],
      ['Pooja Shetty', ['Dairy'], ['Vegetarian']],
      ['Manoj Pillai', [], ['Jain']],
      ['Shruti Hegde', [], ['Vegetarian']],
    ],
  },
  {
    name: 'Nimbus Labs',
    domains: ['nimbuslabs.dev'],
    tier: 'Startup',
    addresses: [['HSR studio', '27th Main, HSR Layout Sector 2, Bengaluru 560102']],
    deliveryTime: '12:45',
    dispatchLeadMinutes: 45,
    packaging: 'Eco bagasse box',
    instructions: 'Call the office manager on arrival, the bell is broken.',
    hiddenCategories: ['Desserts'],
    employees: [
      ['Nikhil Reddy', [], [], 'all'],
      ['Isha Kapoor', [], ['Vegan']],
      ['Tanvi Malhotra', ['Gluten'], []],
      ['Aman Gupta', [], []],
    ],
  },
  {
    // A hospital: open every day, so there are deliveries whatever day it is.
    name: 'Orbit Health',
    domains: ['orbithealth.in'],
    tier: 'Enterprise',
    addresses: [
      ['Main hospital, staff canteen', 'Bannerghatta Main Rd, Bengaluru 560076'],
      ['Outpatient block', 'Arekere Gate, Bannerghatta Rd, Bengaluru 560076'],
    ],
    deliveryTime: '13:30',
    dispatchLeadMinutes: 45,
    workingDays: [1, 2, 3, 4, 5, 6, 7],
    packaging: 'Individually labelled',
    instructions: 'Deliver to the staff canteen, not the main reception.',
    employees: [
      ['Dr Kavya Rao', [], ['Vegetarian'], 'all'],
      ['Dr Imran Khan', [], ['High protein'], 'address'],
      ['Sister Mary Thomas', ['Nuts'], []],
      ['Arvind Iyengar', [], ['Jain']],
      ['Deepa Nambiar', [], ['Vegan']],
      ['Suresh Babu', [], []],
    ],
  },
];

export const DEMO_COMPANY_NAMES = COMPANIES.map((c) => c.name);

const byName = <T extends { id: number; name: string }>(rows: T[]) =>
  new Map(rows.map((row) => [row.name, row.id]));
const idsOf = (map: Map<string, number>, names: string[]) =>
  names.map((name) => ({ id: map.get(name)! }));

export async function seedCatalogue(db: PrismaClient, driverId: number) {
  for (const name of STATIONS) await db.station.create({ data: { name } });
  for (const name of ALLERGENS) await db.allergen.create({ data: { name } });
  for (const name of DIETARY_TAGS) await db.dietaryTag.create({ data: { name } });
  for (const name of PACKAGING) await db.packagingType.create({ data: { name } });
  const stations = byName(await db.station.findMany());
  const allergens = byName(await db.allergen.findMany());
  const tags = byName(await db.dietaryTag.findMany());

  // Tiers: Standard is typed in. Enterprise is Standard less 10%, Partner is
  // cost x 2.6, Startup is typed in but only for some dishes.
  const standard = await db.priceTier.create({ data: { name: 'Standard' } });
  const enterprise = await db.priceTier.create({
    data: { name: 'Enterprise', base: 'TIER', baseTierId: standard.id, factor: 0.9 },
  });
  await db.priceTier.create({ data: { name: 'Partner', base: 'COST', factor: 2.6 } });
  const startup = await db.priceTier.create({ data: { name: 'Startup' } });
  await db.settings.update({ where: { id: 1 }, data: { defaultTierId: standard.id } });

  for (const [name, cost, price, optionAllergens, optionTags] of OPTIONS) {
    const typed = [{ tierId: standard.id, price }];
    if (name !== 'Chicken tikka')
      typed.push({ tierId: startup.id, price: Math.round(price * 0.9) });
    await db.option.create({
      data: {
        name,
        costPrice: cost,
        allergens: { connect: idsOf(allergens, optionAllergens) },
        dietaryTags: { connect: idsOf(tags, optionTags) },
        prices: { create: typed },
      },
    });
  }
  const options = byName(await db.option.findMany());

  let categoryPosition = 0;
  for (const [categoryName, dishes] of Object.entries(DISHES)) {
    const category = await db.menuCategory.create({
      data: {
        name: categoryName,
        position: categoryPosition++,
        secret: SECRET_CATEGORIES.includes(categoryName),
      },
    });
    for (const [position, dish] of dishes.entries()) {
      const typed = [{ tierId: standard.id, price: dish.price }];
      if (STARTUP_SKUS.includes(dish.sku))
        typed.push({ tierId: startup.id, price: Math.round(dish.price * 0.9) });
      if (dish.sku === 'FL-MNS-001') typed.push({ tierId: enterprise.id, price: 22500 }); // a negotiated override
      const created = await db.dish.create({
        data: {
          sku: dish.sku,
          name: dish.name,
          description: dish.description,
          imageUrl: IMAGES[dish.sku] ?? null,
          temperature: dish.temperature,
          costPrice: dish.cost,
          minOrderQty: dish.minOrderQty ?? null,
          active: dish.active ?? true,
          stationId: dish.station ? stations.get(dish.station) : null,
          allergens: { connect: idsOf(allergens, dish.allergens) },
          dietaryTags: { connect: idsOf(tags, dish.tags) },
          prices: { create: typed },
          optionGroups: {
            create: dish.groups.map(([name, required, maxChoices, optionNames], groupPosition) => ({
              name,
              required,
              maxChoices,
              position: groupPosition,
              options: {
                create: optionNames.map((o, i) => ({ optionId: options.get(o)!, position: i })),
              },
            })),
          },
        },
      });
      await db.menuItem.create({ data: { categoryId: category.id, dishId: created.id, position } });
    }
  }
  await seedMissingCompanies(db, driverId);
}

/** Gives demo dishes their photo if they don't have one yet (for databases seeded earlier). */
export async function addMissingDishImages(db: PrismaClient) {
  for (const [sku, imageUrl] of Object.entries(IMAGES)) {
    await db.dish.updateMany({ where: { sku, imageUrl: null }, data: { imageUrl } });
  }
}

/** Creates any demo company that isn't there yet (matched by name). */
export async function seedMissingCompanies(db: PrismaClient, driverId: number) {
  const existing = new Set(
    (await db.company.findMany({ select: { name: true } })).map((c) => c.name),
  );
  const missing = COMPANIES.filter((c) => !existing.has(c.name));
  if (missing.length === 0) return;

  const allergens = byName(await db.allergen.findMany());
  const tags = byName(await db.dietaryTag.findMany());
  const packaging = byName(await db.packagingType.findMany());
  const tierIds = byName(await db.priceTier.findMany());
  const categories = byName(await db.menuCategory.findMany());
  const menuItems = await db.menuItem.findMany({ include: { dish: true } });

  for (const company of missing) {
    const index = COMPANIES.indexOf(company);
    const created = await db.company.create({
      data: {
        name: company.name,
        billingName: `${company.name} Pvt Ltd`,
        billingEmail: `accounts@${company.domains[0]}`,
        billingPhone: `+91 80 4123 ${4100 + index * 11}`,
        workingDays: company.workingDays ?? [1, 2, 3, 4, 5],
        deliveryTime: company.deliveryTime,
        dispatchLeadMinutes: company.dispatchLeadMinutes ?? 60,
        driverInstructions: company.instructions,
        packagingTypeId: packaging.get(company.packaging),
        defaultDriverId: driverId,
        priceTierId: company.tier ? tierIds.get(company.tier) : null,
        domains: { create: company.domains.map((domain) => ({ domain })) },
        addresses: { create: company.addresses.map(([label, text]) => ({ label, text })) },
        holidays: {
          create: (company.holidays ?? []).map(([date, name]) => ({ date: new Date(date), name })),
        },
        hiddenCategories: { connect: idsOf(categories, company.hiddenCategories ?? []) },
        hiddenItems: {
          connect: menuItems
            .filter((item) => company.hiddenDishes?.includes(item.dish.name))
            .map((item) => ({ id: item.id })),
        },
      },
      include: { addresses: true },
    });

    const domain = company.domains[0];
    const employeeIds: number[] = [];
    for (const [name, allergies, diet, flags] of company.employees) {
      const employee = await db.employee.create({
        data: {
          companyId: created.id,
          name,
          // "Dr Kavya Rao" -> kavya.rao@...
          email: `${name
            .replace(/^(Dr|Sister) /, '')
            .toLowerCase()
            .replace(' ', '.')}@${domain}`,
          canChooseAddress: flags !== undefined,
          canChangeTime: flags === 'all',
          canChangePackaging: flags === 'all',
          allergies: { connect: idsOf(allergens, allergies) },
          dietaryPrefs: { connect: idsOf(tags, diet) },
        },
      });
      employeeIds.push(employee.id);
    }
    await db.company.update({
      where: { id: created.id },
      data: { ownerId: employeeIds[0], defaultAddressId: created.addresses[0].id },
    });
  }
}
