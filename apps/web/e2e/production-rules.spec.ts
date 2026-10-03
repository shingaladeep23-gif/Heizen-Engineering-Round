// Every business rule in section 4 of the brief, checked against the live
// stack (browser -> Vercel -> Render -> Neon):
//   BASE_URL=https://fernleaf.vercel.app QA_DATABASE_URL=... npx playwright test e2e/production-rules.spec.ts
//
// production.spec.ts walks the happy path. This file goes after the edges:
// what the server refuses, what each figure adds up to, and what happens when
// two people act at once. It builds its own catalogue items, tiers, companies
// and staff, all marked as test data, and qa-cleanup.ts removes every one of
// them when the run ends. Tests run in order and build on each other.
import { expect, request, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import type {
  AdminDashboard,
  BillingCompany,
  CompanyBilling,
  CompanyDetail,
  Drop,
  EmployeeMenu,
  InvoiceDetail,
  KitchenBoard,
  Lists,
  OrderDetail,
  OrderPage,
  PricedDish,
  Tier,
  TierGrid,
} from '@fernleaf/shared';
import { isLive, PASSWORD, signIn } from './helpers';
import { QA_DOMAIN } from './qa-cleanup';

// ---------- Time, in IST like the app ----------

const IST = 330 * 60_000;
const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const istDay = (plus = 0) => new Date(Date.now() + IST + plus * DAY).toISOString().slice(0, 10);
const isoWeekday = (day: string) => new Date(day).getUTCDay() || 7;
const minutesNow = () => {
  const now = new Date(Date.now() + IST);
  return now.getUTCHours() * 60 + now.getUTCMinutes();
};
/** "HH:mm" today, `minutes` from now, or null if that falls outside today. */
const timeFromNow = (minutes: number) => {
  const m = minutesNow() + minutes;
  return m < 0 || m > 23 * 60 + 59 ? null : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};
const instant = (day: string, time: string) =>
  new Date(Date.parse(`${day}T${time}:00Z`) - IST).toISOString();
const minutesBefore = (iso: string, minutes: number) =>
  new Date(Date.parse(iso) - minutes * 60_000).toISOString();

// The pricing maths, written out independently of the app: whole paise, and
// round *up* to the next 5 paise.
const costTimes2point4 = (cost: number) => Math.ceil((cost * 24) / 50) * 5;
const plus15percent = (price: number) => Math.ceil((price * 115) / 500) * 5;

// ---------- API helpers ----------

async function as(email: string, password = PASSWORD) {
  const ctx = await request.newContext({ baseURL: process.env.BASE_URL });
  const res = await ctx.post('/api/auth/login', { data: { email, password } });
  expect(res.ok(), `sign in as ${email}`).toBe(true);
  return ctx;
}

async function ok<T>(res: APIResponse | Promise<APIResponse>): Promise<T> {
  const response = await res;
  expect(response.ok(), `${response.url()}: ${await response.text()}`).toBe(true);
  return response.json() as Promise<T>;
}

/** Expects the server to refuse, with this status and (optionally) a field error. */
async function refused(res: APIResponse | Promise<APIResponse>, status: number, field?: string) {
  const response = await res;
  const text = await response.text();
  expect(response.status(), `${response.url()}: ${text}`).toBe(status);
  const body = JSON.parse(text) as { message: string; fieldErrors?: Record<string, string> };
  expect(body.message).toBeTruthy(); // always something a person can act on
  if (field) expect(body.fieldErrors?.[field], text).toBeTruthy();
  return body.message;
}

let admin: APIRequestContext;

const get = <T>(path: string, ctx = admin) => ok<T>(ctx.get(path));
const post = (path: string, data?: unknown, ctx = admin) => ctx.post(path, { data });
const put = (path: string, data?: unknown, ctx = admin) => ctx.put(path, { data });

/** All orders matching a filter, every page. */
async function allOrders(query: string) {
  const items: OrderPage['items'] = [];
  for (let page = 1; ; page++) {
    const res = await get<OrderPage>(`/api/orders?${query}&page=${page}`);
    items.push(...res.items);
    if (items.length >= res.total || res.items.length === 0) return items;
  }
}

// ---------- What the run builds, filled in as it goes ----------

const RUN = Date.now().toString(36).toUpperCase();
const COMPANY_A = 'Fernleaf QA Rules';
const COMPANY_B = 'Fernleaf QA Rules B';
const DOMAIN_A = `rules.${QA_DOMAIN}`;
const DOMAIN_B = `rules-b.${QA_DOMAIN}`;

const s = {
  standardTierId: 0,
  qaDriver: 0,
  allergen: 0,
  raita: 0, // cost ₹0.88, the spec's "$2.11 becomes $2.15" case at x2.4
  chutney: 0,
  papad: 0,
  thali: 0, // costs ₹0, so only a typed price can put it on a menu
  costTier: 0, // cost x 2.4
  plusTier: 0, // Standard + 15%
  category: 0,
  menuItem: 0,
  companyA: 0,
  companyB: 0,
  addressA: [0, 0],
  addressB: 0,
  a1: 0, // may change nothing
  a2: 0, // may change everything
  a3: 0, // may change everything; moves to company B later
  b1: 0,
  rajma: undefined as PricedDish | undefined, // a real dish, from company B's menu
  orders: {} as Record<string, number>,
  times: {} as Record<string, string>,
};

/** A valid combination for a dish: the first option of every required group. */
const firstChoices = (dish: PricedDish) =>
  dish.groups.filter((g) => g.required).map((g) => g.options[0].id);

const thaliLine = (combos: { quantity: number; optionIds: number[] }[]) => ({
  dishId: s.thali,
  quantity: combos.reduce((sum, c) => sum + c.quantity, 0),
  combos,
});

async function placeOrder(body: Record<string, unknown>) {
  return ok<{ id: number; status: string; total: number }>(
    post('/api/orders', { place: true, ...body }),
  );
}

const order = (id: number) => get<OrderDetail>(`/api/orders/${id}`);
const board = (day = istDay()) => get<KitchenBoard>(`/api/kitchen?date=${day}`);
const unitsOf = async (orderId: number) =>
  (await board()).units.filter((u) => u.orderId === orderId);
const drops = () => get<Drop[]>(`/api/dispatch/drops?date=${istDay()}`);
const dropOf = async (orderId: number) => {
  const drop = (await drops()).find((d) => d.orders.some((o) => o.id === orderId));
  expect(drop, `drop for order #${orderId}`).toBeTruthy();
  return drop!;
};

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.describe('business rules on the live site', () => {
  test.skip(!isLive, 'runs against the live site only (BASE_URL=...)');

  test.beforeAll(async () => {
    admin = await as('admin@test.com');
    const tiers = await get<Tier[]>('/api/tiers');
    s.standardTierId = tiers.find((t) => t.isDefault)!.id;
  });

  // ---------- Staff and roles (section 3) ----------

  test('admins create staff, change roles and switch accounts off, all enforced at once', async () => {
    const driver = await ok<{ id: number }>(
      post('/api/staff', {
        name: 'QA Driver',
        email: `qa.driver@${QA_DOMAIN}`,
        password: PASSWORD,
        role: 'DRIVER',
      }),
    );
    s.qaDriver = driver.id;
    await refused(
      post('/api/staff', {
        name: 'Twin',
        email: `qa.driver@${QA_DOMAIN}`,
        password: PASSWORD,
        role: 'DRIVER',
      }),
      409,
      'email',
    );
    await refused(
      post('/api/staff', {
        name: 'Short',
        email: `short@${QA_DOMAIN}`,
        password: 'x',
        role: 'ADMIN',
      }),
      400,
      'password',
    );

    const cook = await ok<{ id: number }>(
      post('/api/staff', {
        name: 'QA Cook',
        email: `qa.cook@${QA_DOMAIN}`,
        password: PASSWORD,
        role: 'KITCHEN',
      }),
    );
    const cookCtx = await as(`qa.cook@${QA_DOMAIN}`);
    expect((await cookCtx.get('/api/kitchen')).status()).toBe(200);
    expect((await cookCtx.get('/api/dispatch/drops')).status()).toBe(403);
    expect((await cookCtx.post('/api/staff', { data: {} })).status()).toBe(403);

    // A role change applies to the very next request, same session.
    await ok(put(`/api/staff/${cook.id}`, { role: 'DISPATCH', active: true }));
    expect((await cookCtx.get('/api/dispatch/drops')).status()).toBe(200);
    expect((await cookCtx.get('/api/kitchen')).status()).toBe(403);

    // Switched off: the open session stops working, and so does signing in.
    await ok(put(`/api/staff/${cook.id}`, { role: 'DISPATCH', active: false }));
    expect((await cookCtx.get('/api/dispatch/drops')).status()).toBe(401);
    const again = await request.newContext({ baseURL: process.env.BASE_URL });
    const login = await again.post('/api/auth/login', {
      data: { email: `qa.cook@${QA_DOMAIN}`, password: PASSWORD },
    });
    expect(login.ok()).toBe(false);

    // An admin can't lock themselves out.
    const me = await get<{ id: number }>('/api/auth/me');
    await refused(put(`/api/staff/${me.id}`, { role: 'ADMIN', active: false }), 400);
    await refused(put(`/api/staff/${me.id}`, { role: 'KITCHEN', active: true }), 400);
  });

  // ---------- Catalogue (4.1) ----------

  test('catalogue: reference lists, options, a dish with option groups, and what is refused', async ({
    page,
  }) => {
    const allergen = await ok<{ id: number }>(
      post('/api/lists/allergens', { name: 'QA Mustard Seed' }),
    );
    s.allergen = allergen.id;
    await refused(post('/api/lists/allergens', { name: 'QA Mustard Seed' }), 409);

    const option = (name: string, costPrice: number, allergenIds: number[] = []) =>
      ok<{ id: number }>(post('/api/options', { name, costPrice, allergenIds }));
    s.raita = (await option('QA Raita', 88, [s.allergen])).id;
    s.chutney = (await option('QA Mint Chutney', 1000)).id;
    s.papad = (await option('QA Papad', 500)).id;
    await refused(post('/api/options', { name: 'QA Bad', costPrice: 12.5 }), 400, 'costPrice');
    await refused(post('/api/options', { name: 'QA Bad', costPrice: -100 }), 400, 'costPrice');

    const dish = {
      sku: `QA-THALI-${RUN}`,
      name: 'QA Thali',
      description: 'Test dish for the automated checks',
      temperature: 'HOT',
      costPrice: 0,
      minOrderQty: 3,
      stationId: null, // so the kitchen shows it as "Unassigned"
      optionGroups: [
        { name: 'QA side', required: true, maxChoices: 1, optionIds: [s.raita, s.chutney] },
        { name: 'QA add-on', required: false, maxChoices: 1, optionIds: [s.papad] },
      ],
    };
    s.thali = (await ok<{ id: number }>(post('/api/dishes', dish))).id;

    // Refused: a duplicate SKU, more choices than options, an option listed twice.
    await refused(post('/api/dishes', { ...dish, name: 'QA Copy' }), 409);
    await refused(
      post('/api/dishes', {
        ...dish,
        sku: `QA-X-${RUN}`,
        optionGroups: [{ name: 'QA g', required: true, maxChoices: 3, optionIds: [s.raita] }],
      }),
      400,
      'optionGroups.0.maxChoices',
    );
    await refused(
      post('/api/dishes', {
        ...dish,
        sku: `QA-Y-${RUN}`,
        optionGroups: [
          { name: 'QA g', required: true, maxChoices: 1, optionIds: [s.raita, s.raita] },
        ],
      }),
      400,
      'optionGroups.0.optionIds',
    );

    // An allergen in use can't be removed (it would silently untag the option).
    await refused(admin.delete(`/api/lists/allergens/${s.allergen}`), 409);

    // The dish keeps its groups, in order.
    const saved = await get<{ optionGroups: { name: string; optionIds: number[] }[] }>(
      `/api/dishes/${s.thali}`,
    );
    expect(saved.optionGroups.map((g) => g.name)).toEqual(['QA side', 'QA add-on']);
    expect(saved.optionGroups[0].optionIds).toEqual([s.raita, s.chutney]);

    await signIn(page, 'admin@test.com');
    await page.goto('/dishes');
    await expect(page.getByRole('cell', { name: 'QA Thali' })).toBeVisible();

    // Kitchen can read the catalogue but not change it.
    const kitchen = await as('kitchen@test.com');
    expect((await kitchen.get(`/api/dishes/${s.thali}`)).status()).toBe(200);
    expect((await kitchen.put(`/api/dishes/${s.thali}`, { data: dish })).status()).toBe(403);
  });

  // ---------- Pricing (4.3) ----------

  test('pricing: tiers derived from cost and from another tier round up to 5 paise', async ({
    page,
  }) => {
    s.costTier = (
      await ok<{ id: number }>(
        post('/api/tiers', { name: 'QA Cost x2.4', base: 'COST', factor: 2.4 }),
      )
    ).id;
    s.plusTier = (
      await ok<{ id: number }>(
        post('/api/tiers', {
          name: 'QA Standard +15%',
          base: 'TIER',
          baseTierId: s.standardTierId,
          factor: 1.15,
        }),
      )
    ).id;
    // A derived tier needs its factor, and can't be built on another derived tier.
    await refused(post('/api/tiers', { name: 'QA No factor', base: 'COST' }), 400, 'factor');
    await refused(
      post('/api/tiers', { name: 'QA Chain', base: 'TIER', baseTierId: s.plusTier, factor: 2 }),
      400,
    );

    const costGrid = await get<TierGrid>(`/api/tiers/${s.costTier}/grid`);
    // The spec's own example: 0.88 x 2.4 = 2.112, which rounds up to 2.15.
    expect(costGrid.options.find((o) => o.id === s.raita)!.price).toBe(215);
    expect(costGrid.options.find((o) => o.id === s.chutney)!.price).toBe(2400);
    for (const row of [...costGrid.dishes, ...costGrid.options]) {
      if (row.typed !== null) continue;
      expect(row.price, row.name).toBe(row.cost > 0 ? costTimes2point4(row.cost) : null);
    }
    // ₹0 cost means no price at all, never a ₹0 price.
    const thaliRow = costGrid.dishes.find((d) => d.id === s.thali)!;
    expect(thaliRow.price).toBeNull();
    expect(costGrid.tier.missingDishes).toBeGreaterThanOrEqual(1);

    const standard = await get<TierGrid>(`/api/tiers/${s.standardTierId}/grid`);
    const plus = await get<TierGrid>(`/api/tiers/${s.plusTier}/grid`);
    for (const row of plus.dishes) {
      const base = standard.dishes.find((d) => d.id === row.id)!.price;
      expect(row.price, row.name).toBe(base === null ? null : plus15percent(base));
    }

    // An override wins over the formula, and fills the gap.
    await ok(put(`/api/tiers/${s.costTier}/prices`, { kind: 'dish', id: s.thali, price: 25000 }));
    await refused(
      put(`/api/tiers/${s.costTier}/prices`, { kind: 'dish', id: s.thali, price: 0 }),
      400,
      'price',
    );
    const after = await get<TierGrid>(`/api/tiers/${s.costTier}/grid`);
    expect(after.dishes.find((d) => d.id === s.thali)).toMatchObject({
      typed: 25000,
      price: 25000,
    });
    expect(after.tier.missingDishes).toBe(costGrid.tier.missingDishes - 1);

    // The whole-tier view shows it.
    await signIn(page, 'admin@test.com');
    await page.goto('/tiers');
    await page.getByText('QA Cost x2.4', { exact: true }).click();
    await expect(page.getByRole('row', { name: /QA Thali/ })).toContainText('₹250.00');
    await expect(page.getByRole('row', { name: /QA Raita/ })).toContainText('₹2.15');
  });

  // ---------- Companies and employees (4.4, 4.5) ----------

  test('companies: domains, addresses, calendar, owner and delivery defaults are checked', async () => {
    const lists = await get<Lists>('/api/lists');
    const company = {
      name: COMPANY_A,
      domains: [DOMAIN_A],
      addresses: [
        { label: 'QA tower A', text: 'Test address one, not a real place' },
        { label: 'QA tower B', text: 'Test address two, not a real place' },
      ],
      billingName: 'Fernleaf QA Rules Pvt Ltd',
      billingEmail: `accounts@${DOMAIN_A}`,
      workingDays: [1, 2, 3, 4, 5, 6, 7],
      deliveryTime: '12:30',
      dispatchLeadMinutes: 45,
      packagingTypeId: lists['packaging-types'][0].id,
      driverInstructions: 'QA test drop',
      defaultDriverId: s.qaDriver,
      priceTierId: s.costTier,
    };

    // Refused: a public email domain, a domain another company owns, a
    // default driver who isn't a driver.
    await refused(post('/api/companies', { ...company, domains: ['gmail.com'] }), 400, 'domains');
    const others = await get<{ name: string; domains: string[] }[]>('/api/companies');
    const taken = others.find((c) => !c.name.startsWith('Fernleaf QA'))!.domains[0];
    await refused(post('/api/companies', { ...company, domains: [taken] }), 400, 'domains');
    const me = await get<{ id: number }>('/api/auth/me');
    await refused(
      post('/api/companies', { ...company, defaultDriverId: me.id }),
      400,
      'defaultDriverId',
    );

    s.companyA = (await ok<{ id: number }>(post('/api/companies', company))).id;
    // Company B: default tier, no default driver, closed one weekday.
    const closed = isoWeekday(istDay(9));
    s.companyB = (
      await ok<{ id: number }>(
        post('/api/companies', {
          ...company,
          name: COMPANY_B,
          domains: [DOMAIN_B],
          addresses: [{ label: 'QA B desk', text: 'Test address, not a real place' }],
          billingEmail: `accounts@${DOMAIN_B}`,
          workingDays: [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== closed),
          holidays: [{ date: istDay(10), name: 'QA company holiday' }],
          defaultDriverId: null,
          priceTierId: null,
        }),
      )
    ).id;

    const employee = (companyId: number, name: string, email: string, may: boolean) =>
      ok<{ id: number }>(
        post('/api/employees', {
          companyId,
          name,
          email,
          canChooseAddress: may,
          canChangeTime: may,
          canChangePackaging: may,
          allergyIds: name === 'QA Rules One' ? [s.allergen] : [],
        }),
      );
    s.a1 = (await employee(s.companyA, 'QA Rules One', `one@${DOMAIN_A}`, false)).id;
    s.a2 = (await employee(s.companyA, 'QA Rules Two', `two@${DOMAIN_A}`, true)).id;
    s.a3 = (await employee(s.companyA, 'QA Rules Three', `three@${DOMAIN_A}`, true)).id;
    s.b1 = (await employee(s.companyB, 'QA Rules Bee', `bee@${DOMAIN_B}`, true)).id;

    // Employees: email must be on the company's domain, and unique.
    await refused(
      post('/api/employees', { companyId: s.companyA, name: 'Out', email: `out@${DOMAIN_B}` }),
      400,
      'email',
    );
    await refused(
      post('/api/employees', { companyId: s.companyA, name: 'Dup', email: `one@${DOMAIN_A}` }),
      409,
    );

    // The owner must be one of the company's own employees.
    const detail = await get<CompanyDetail>(`/api/companies/${s.companyA}`);
    s.addressA = detail.addresses.map((a) => a.id!);
    const update = (changes: Record<string, unknown>) =>
      put(`/api/companies/${s.companyA}`, {
        ...company,
        addresses: detail.addresses,
        ...changes,
      });
    await refused(update({ ownerId: s.b1 }), 400, 'ownerId');
    await ok(update({ ownerId: s.a1 }));
    // A domain its employees still use can't be dropped.
    await refused(update({ domains: [`other.${QA_DOMAIN}`], ownerId: s.a1 }), 400, 'domains');
    // The owner can't be moved out of the company they own.
    await refused(
      put(`/api/employees/${s.a1}`, {
        companyId: s.companyB,
        name: 'QA Rules One',
        email: `one@${DOMAIN_B}`,
      }),
      409,
    );
    s.addressB = (await get<CompanyDetail>(`/api/companies/${s.companyB}`)).addresses[0].id!;
  });

  // ---------- Menu (4.2) ----------

  test('menu: secret categories, hiding per company, and no price means not on the menu', async ({
    page,
  }) => {
    s.category = (
      await ok<{ id: number }>(post('/api/menu/categories', { name: 'QA Specials', secret: true }))
    ).id;
    s.menuItem = (
      await ok<{ id: number }>(
        post(`/api/menu/categories/${s.category}/items`, { dishId: s.thali }),
      )
    ).id;
    const preview = (employeeId: number, extra = '') =>
      get<EmployeeMenu>(`/api/menu/preview?employeeId=${employeeId}${extra}`);
    const dishesIn = (menu: EmployeeMenu) => menu.categories.flatMap((c) => c.dishes);

    // Secret: not listed, but it can be opened.
    const listed = await preview(s.a1);
    expect(listed.tierName).toBe('QA Cost x2.4');
    expect(listed.categories.map((c) => c.name)).not.toContain('QA Specials');
    expect(listed.secretCategories.map((c) => c.name)).toContain('QA Specials');
    const opened = await preview(s.a1, `&categoryId=${s.category}`);
    const thali = dishesIn(opened).find((d) => d.id === s.thali)!;
    expect(thali.price).toBe(25000);
    // Only options priced on the tier: chutney 10 x 2.4 = 24, raita 2.15.
    expect(thali.groups[0].options.map((o) => [o.name, o.price])).toEqual([
      ['QA Raita', 215],
      ['QA Mint Chutney', 2400],
    ]);
    // Allergens travel with each option, so staff can see what a choice contains.
    expect(thali.groups[0].options[0].allergens).toEqual(['QA Mustard Seed']);

    // Company B is on the default tier, where the thali has no price: it must
    // not appear at all, not even at ₹0.
    const b = await preview(s.b1, '&allSecret=true');
    expect(dishesIn(b).map((d) => d.id)).not.toContain(s.thali);
    expect(b.tierName).toBe((await get<Tier[]>('/api/tiers')).find((t) => t.isDefault)!.name);
    s.rajma = dishesIn(b).find((d) => d.name === 'Rajma Chawal Bowl');
    expect(s.rajma, 'Rajma Chawal Bowl on the default tier').toBeTruthy();

    // Every price on B's menu is the default tier's price.
    const standard = await get<TierGrid>(`/api/tiers/${s.standardTierId}/grid`);
    for (const dish of dishesIn(b)) {
      expect(dish.price, dish.name).toBe(standard.dishes.find((d) => d.id === dish.id)!.price);
    }

    // Hidden from company A: gone from A's menu, still on nobody else's.
    const companyA = await get<CompanyDetail>(`/api/companies/${s.companyA}`);
    const save = (hiddenItemIds: number[], hiddenCategoryIds: number[]) =>
      ok(
        put(`/api/companies/${s.companyA}`, {
          ...companyA,
          hiddenItemIds,
          hiddenCategoryIds,
        }),
      );
    await save([s.menuItem], []);
    expect(dishesIn(await preview(s.a1, '&allSecret=true')).map((d) => d.id)).not.toContain(
      s.thali,
    );
    await save([], [s.category]);
    expect(dishesIn(await preview(s.a1, '&allSecret=true')).map((d) => d.id)).not.toContain(
      s.thali,
    );
    await save([], []);

    // An inactive menu item, then an inactive category, hide it too.
    await ok(put(`/api/menu/items/${s.menuItem}`, { active: false }));
    expect(dishesIn(await preview(s.a1, '&allSecret=true')).map((d) => d.id)).not.toContain(
      s.thali,
    );
    await ok(put(`/api/menu/items/${s.menuItem}`, { active: true }));
    await ok(
      put(`/api/menu/categories/${s.category}`, {
        name: 'QA Specials',
        secret: true,
        active: false,
      }),
    );
    expect(dishesIn(await preview(s.a1, '&allSecret=true')).map((d) => d.id)).not.toContain(
      s.thali,
    );
    await ok(
      put(`/api/menu/categories/${s.category}`, {
        name: 'QA Specials',
        secret: true,
        active: true,
      }),
    );

    // The preview screen, as staff see it.
    await signIn(page, 'admin@test.com');
    await page.goto('/preview');
    await page.getByRole('combobox', { name: 'Employee' }).fill('QA Rules One');
    await page.getByRole('option', { name: /QA Rules One/ }).click();
    await expect(page.getByText('priced on the QA Cost x2.4 tier')).toBeVisible();
    await page.getByRole('combobox', { name: 'Open a secret category' }).click();
    await page.getByRole('option', { name: 'QA Specials' }).click();
    await expect(page.locator('.mantine-Card-root', { hasText: 'QA Thali' })).toContainText(
      '₹250.00',
    );
  });

  // ---------- Orders: what the server refuses (4.1, 4.6) ----------

  test('orders: every rule is checked on the server, with an error on the right field', async () => {
    const day = istDay(7);
    const base = { employeeId: s.a2, deliveryDate: day, place: true };
    const bad = (body: Record<string, unknown>, field: string) =>
      refused(post('/api/orders', { ...base, ...body }), 400, field);

    // Combinations must add up to the line.
    await bad(
      {
        lines: [{ dishId: s.thali, quantity: 5, combos: [{ quantity: 3, optionIds: [s.raita] }] }],
      },
      'lines.0.quantity',
    );
    // Every combination fills every required group...
    await bad({ lines: [thaliLine([{ quantity: 3, optionIds: [s.papad] }])] }, 'lines.0.combos.0');
    // ...within its max choices...
    await bad(
      { lines: [thaliLine([{ quantity: 3, optionIds: [s.raita, s.chutney] }])] },
      'lines.0.combos.0',
    );
    // ...using only options the dish offers.
    await bad(
      { lines: [thaliLine([{ quantity: 3, optionIds: [s.raita, firstChoices(s.rajma!)[0]] }])] },
      'lines.0.combos.0',
    );
    // The same choices twice must be one combination (one prep unit).
    await bad(
      {
        lines: [
          thaliLine([
            { quantity: 2, optionIds: [s.raita] },
            { quantity: 2, optionIds: [s.raita] },
          ]),
        ],
      },
      'lines.0.combos.1',
    );
    // The minimum order quantity (3).
    await bad({ lines: [thaliLine([{ quantity: 2, optionIds: [s.raita] }])] }, 'lines.0.quantity');
    // A dish that isn't on this employee's menu (B has no price for it).
    await refused(
      post('/api/orders', {
        employeeId: s.b1,
        deliveryDate: day,
        place: true,
        lines: [thaliLine([{ quantity: 3, optionIds: [s.raita] }])],
      }),
      400,
      'lines.0',
    );

    // Delivery details: A1 may not change any of them...
    const line = [thaliLine([{ quantity: 3, optionIds: [s.raita] }])];
    const lists = await get<Lists>('/api/lists');
    const a1 = { employeeId: s.a1, deliveryDate: day, place: true, lines: line };
    await refused(post('/api/orders', { ...a1, deliveryTime: '13:15' }), 400, 'deliveryTime');
    await refused(post('/api/orders', { ...a1, addressId: s.addressA[1] }), 400, 'addressId');
    await refused(
      post('/api/orders', { ...a1, packagingTypeId: lists['packaging-types'].at(-1)!.id }),
      400,
      'packagingTypeId',
    );
    // ...and nobody may use another company's address.
    await refused(
      post('/api/orders', { ...base, lines: line, addressId: s.addressB }),
      400,
      'addressId',
    );

    // Dates: in the past, the company's day off, the company's holiday.
    const b = {
      employeeId: s.b1,
      place: true,
      lines: [
        {
          dishId: s.rajma!.id,
          quantity: 1,
          combos: [{ quantity: 1, optionIds: firstChoices(s.rajma!) }],
        },
      ],
    };
    await refused(post('/api/orders', { ...b, deliveryDate: istDay(-1) }), 400, 'deliveryDate');
    await refused(post('/api/orders', { ...b, deliveryDate: istDay(9) }), 400, 'deliveryDate');
    await refused(post('/api/orders', { ...b, deliveryDate: istDay(10) }), 400, 'deliveryDate');

    // Only admins create orders.
    const kitchen = await as('kitchen@test.com');
    expect((await kitchen.post('/api/orders', { data: { ...a1 } })).status()).toBe(403);

    // A1 with the company defaults is fine; drafts are allowed before the cut-off.
    const draft = await placeOrder({ ...a1, place: false });
    expect(draft.status).toBe('DRAFT');
    const detail = await order(draft.id);
    expect(detail.deliveryTime).toBe('12:30');
    expect(detail.address.id).toBe(s.addressA[0]);
    expect(detail.cutoffPassed).toBe(false);
    s.orders.draft = draft.id;
  });

  test('orders: the price is worked out on the server, line by line, and totals reconcile', async () => {
    // 3 x (250 + 2.15 raita) + 1 x (250 + 24 chutney + 12 papad)
    //   = 756.45 + 286.00 = 1,042.45
    const placed = await placeOrder({
      employeeId: s.a2,
      deliveryDate: istDay(7),
      deliveryTime: '13:10',
      lines: [
        thaliLine([
          { quantity: 3, optionIds: [s.raita] },
          { quantity: 1, optionIds: [s.chutney, s.papad] },
        ]),
      ],
    });
    expect(placed.status).toBe('PLACED'); // before the cut-off
    const detail = await order(placed.id);
    expect(detail.total).toBe(104245);
    const [line] = detail.lines;
    expect(line).toMatchObject({ dishName: 'QA Thali', dishPrice: 25000, quantity: 4 });
    expect(line.combos.map((c) => [c.quantity, c.unitPrice, c.total])).toEqual([
      [3, 25215, 75645],
      [1, 28600, 28600],
    ]);
    expect(line.combos[1].choices.map((c) => c.optionName)).toEqual([
      'QA Mint Chutney',
      'QA Papad',
    ]);
    expect(detail.total).toBe(detail.lines.reduce((sum, l) => sum + l.total, 0));
    s.orders.priced = placed.id;
  });

  test('orders: a later price change never touches a past order, only new ones', async () => {
    await ok(put(`/api/tiers/${s.costTier}/prices`, { kind: 'dish', id: s.thali, price: 26000 }));
    const old = await order(s.orders.priced);
    expect(old.total).toBe(104245);
    expect(old.lines[0].dishPrice).toBe(25000);

    const fresh = await placeOrder({
      employeeId: s.a2,
      deliveryDate: istDay(7),
      deliveryTime: '13:20',
      lines: [thaliLine([{ quantity: 3, optionIds: [s.raita] }])],
    });
    expect((await order(fresh.id)).lines[0].dishPrice).toBe(26000);

    // Editing a placed order re-prices it at today's price, on the server.
    await ok(
      put(`/api/orders/${s.orders.priced}`, {
        employeeId: s.a2,
        deliveryDate: istDay(7),
        deliveryTime: '13:10',
        place: true,
        lines: [thaliLine([{ quantity: 3, optionIds: [s.raita] }])],
      }),
    );
    expect((await order(s.orders.priced)).total).toBe(3 * (26000 + 215));

    // Changing the dish itself doesn't rename old order lines either.
    const dish = await get<Record<string, unknown>>(`/api/dishes/${s.thali}`);
    await ok(put(`/api/dishes/${s.thali}`, { ...dish, name: 'QA Thali (renamed)' }));
    expect((await order(fresh.id)).lines[0].dishName).toBe('QA Thali');
    await ok(put(`/api/dishes/${s.thali}`, { ...dish, name: 'QA Thali' }));
    await ok(put(`/api/tiers/${s.costTier}/prices`, { kind: 'dish', id: s.thali, price: 25000 }));
    s.orders.fresh = fresh.id;
  });

  test('employees: moving to another company changes their menu and prices, not old bills', async () => {
    const before = await order(s.orders.fresh);
    await ok(
      put(`/api/employees/${s.a3}`, {
        companyId: s.companyB,
        name: 'QA Rules Three',
        email: `three@${DOMAIN_B}`,
        canChooseAddress: true,
        canChangeTime: true,
        canChangePackaging: true,
      }),
    );
    const menu = await get<EmployeeMenu>(`/api/menu/preview?employeeId=${s.a3}&allSecret=true`);
    expect(menu.employee.companyName).toBe(COMPANY_B);
    expect(menu.categories.flatMap((c) => c.dishes).map((d) => d.id)).not.toContain(s.thali);
    expect((await order(s.orders.fresh)).company.id).toBe(before.company.id);
    // Moved back for the kitchen and dispatch checks below.
    await ok(
      put(`/api/employees/${s.a3}`, {
        companyId: s.companyA,
        name: 'QA Rules Three',
        email: `three@${DOMAIN_A}`,
        canChooseAddress: true,
        canChangeTime: true,
        canChangePackaging: true,
      }),
    );
  });

  // ---------- Cut-off (4.6) and settings (4.10) ----------

  test('cut-off: counts back over kitchen working days, skipping kitchen holidays', async () => {
    const settings = await get<{
      kitchenWorkingDays: number[];
      cutoffTime: string;
      cutoffDays: number;
      kitchenBufferMinutes: number;
      atRiskMinutes: number;
      onTimeGraceMinutes: number;
      holidays: { date: string; name: string }[];
    }>('/api/settings');
    // Sent back as read: the API ignores the fields it doesn't take (id, default tier).
    const values = settings;
    // Settings are validated too.
    await refused(put('/api/settings', { ...values, cutoffTime: '25:00' }), 400, 'cutoffTime');
    await refused(
      put('/api/settings', { ...values, kitchenWorkingDays: [] }),
      400,
      'kitchenWorkingDays',
    );

    // Far enough out to be clear of the demo orders.
    const holiday = istDay(20);
    const after = istDay(21);
    const info = (day: string) =>
      get<{ cutoffAt: string; problems: string[] }>(
        `/api/orders/delivery-info?employeeId=${s.a2}&date=${day}`,
      );
    // Count back by hand: the n-th kitchen working day before `day`.
    const expected = (day: string, holidays: string[]) => {
      let d = day;
      for (let counted = 0; counted < values.cutoffDays;) {
        d = new Date(Date.parse(d) - DAY).toISOString().slice(0, 10);
        if (values.kitchenWorkingDays.includes(isoWeekday(d)) && !holidays.includes(d)) counted++;
      }
      return instant(d, values.cutoffTime);
    };
    const existing = values.holidays.map((h) => h.date);
    expect((await info(after)).cutoffAt).toBe(expected(after, existing));
    const unmovedAt = (await info(after)).cutoffAt;

    await ok(
      put('/api/settings', {
        ...values,
        holidays: [...values.holidays, { date: holiday, name: 'QA kitchen holiday' }],
      }),
    );
    try {
      const moved = (await info(after)).cutoffAt;
      expect(moved).toBe(expected(after, [...existing, holiday]));
      if (values.cutoffDays > 0) expect(moved < unmovedAt).toBe(true); // a day earlier
      // Nothing can be delivered on the kitchen's holiday.
      expect((await info(holiday)).problems.join(' ')).toContain("kitchen isn't cooking");
    } finally {
      await ok(put('/api/settings', values)); // put everything back exactly
    }
    const restored = await get<typeof settings>('/api/settings');
    expect(restored.holidays).toEqual(settings.holidays);

    // The company calendar never moves the cut-off: B (closed on one weekday,
    // with a holiday) gets the same cut-off as A for the same date.
    const forB = await get<{ cutoffAt: string }>(
      `/api/orders/delivery-info?employeeId=${s.b1}&date=${istDay(12)}`,
    );
    expect(forB.cutoffAt).toBe((await info(istDay(12))).cutoffAt);

    // Kitchen can't change settings.
    const kitchen = await as('kitchen@test.com');
    expect((await kitchen.put('/api/settings', { data: values })).status()).toBe(403);
  });

  test('cut-off: drafts and placed orders lock for everyone but an admin', async () => {
    // Tomorrow's cut-off has passed (2 working days at 16:00), so an admin
    // placing now confirms straight away and a draft is refused.
    const line = [thaliLine([{ quantity: 3, optionIds: [s.raita] }])];
    const body = { employeeId: s.a2, deliveryDate: istDay(1), deliveryTime: '12:05', lines: line };
    await refused(post('/api/orders', { ...body, place: false }), 400, 'deliveryDate');
    const late = await placeOrder(body);
    expect(late.status).toBe('CONFIRMED');
    const detail = await order(late.id);
    expect(detail.cutoffPassed).toBe(true);
    expect(detail.driver?.name).toBe('QA Driver'); // the company's default driver
    // Confirmed lines can't be edited, even by an admin.
    await refused(put(`/api/orders/${late.id}`, { ...body, place: true }), 409);
    s.orders.tomorrow = late.id;

    // Running the cut-off by hand for a date that hasn't reached it is refused.
    await refused(post('/api/orders/cutoff/run', { date: istDay(7) }), 400, 'date');
  });

  // ---------- Kitchen board (4.7) ----------

  test('kitchen: units, start/done rules, roll-ups, stations and late or at-risk work', async ({
    page,
  }) => {
    // Due in 2.5 h: cooked by +1h 15m, well clear of the 30-minute at-risk window.
    const later = timeFromNow(150);
    test.skip(!later, 'needs two and a half hours left in the IST day');
    s.times.later = later!;
    // X and Y share a time and address (one drop), Z is the same time at the
    // other address (another drop).
    const make = (employeeId: number, time: string, extra: Record<string, unknown> = {}) =>
      placeOrder({
        employeeId,
        deliveryDate: istDay(),
        deliveryTime: time,
        lines: [
          thaliLine([
            { quantity: 2, optionIds: [s.raita] },
            { quantity: 1, optionIds: [s.chutney] },
          ]),
        ],
        ...extra,
      });
    const x = await make(s.a2, later!);
    const y = await make(s.a3, later!);
    const z = await make(s.a2, later!, { addressId: s.addressA[1] });
    expect([x.status, y.status, z.status]).toEqual(['CONFIRMED', 'CONFIRMED', 'CONFIRMED']);
    Object.assign(s.orders, { x: x.id, y: y.id, z: z.id });

    // One unit per distinct combination, at "Unassigned" (no station).
    const units = await unitsOf(x.id);
    expect(units).toHaveLength(2);
    expect(units.map((u) => [u.quantity, u.choices, u.station])).toEqual(
      expect.arrayContaining([
        [2, 'QA Raita', 'Unassigned'],
        [1, 'QA Mint Chutney', 'Unassigned'],
      ]),
    );
    // Planned times worked back from delivery: 45 min to leave, 30 to cook.
    const plan = (await order(x.id)).plan;
    const deliverAt = instant(istDay(), later!);
    expect(plan.dispatchReadyBy).toBe(minutesBefore(deliverAt, 45));
    expect(plan.kitchenReadyBy).toBe(minutesBefore(deliverAt, 75));
    expect(units[0].kitchenReadyBy).toBe(plan.kitchenReadyBy);
    expect(units.every((u) => u.state === 'todo')).toBe(true);

    const [first, second] = units;
    const kitchen = await as('kitchen@test.com');
    const mark = (id: number, action: 'start' | 'done') =>
      kitchen.post(`/api/kitchen/units/${id}/${action}`);

    // Start once, not twice. Done once, not twice.
    await ok(mark(first.id, 'start'));
    await refused(mark(first.id, 'start'), 409);
    let detail = await order(x.id);
    expect(detail.timeline.map((t) => t.label)).toContain('Kitchen started');
    expect(detail.timeline.map((t) => t.label)).not.toContain('Kitchen ready');
    await ok(mark(first.id, 'done'));
    await refused(mark(first.id, 'done'), 409);
    // One unit left, so the order isn't kitchen-ready yet.
    detail = await order(x.id);
    expect(detail.timeline.map((t) => t.label)).not.toContain('Kitchen ready');

    // Finishing a unit that was never started records a start as well.
    await ok(mark(second.id, 'done'));
    const after = await unitsOf(x.id);
    const secondAfter = after.find((u) => u.id === second.id)!;
    expect(secondAfter.startedAt).toBe(secondAfter.doneAt);
    detail = await order(x.id);
    const at = (label: string) => detail.timeline.find((t) => t.label === label)?.at;
    expect(at('Kitchen ready')).toBe(secondAfter.doneAt);
    expect(at('Kitchen started')).toBe(after.find((u) => u.id === first.id)!.startedAt);

    // Two cooks pressing Done on the same unit at once: exactly one wins.
    const yUnits = await unitsOf(y.id);
    const results = await Promise.all([1, 2, 3].map(() => mark(yUnits[0].id, 'done')));
    expect(results.map((r) => r.status()).sort()).toEqual([200, 409, 409]);
    await ok(mark(yUnits[1].id, 'done'));

    // An admin force-completes a whole order; the kitchen can't.
    expect((await kitchen.post(`/api/kitchen/orders/${z.id}/complete`)).status()).toBe(403);
    await ok(post(`/api/kitchen/orders/${z.id}/complete`));
    expect((await unitsOf(z.id)).every((u) => u.doneAt !== null)).toBe(true);
    await refused(post(`/api/kitchen/orders/${z.id}/complete`), 409); // nothing left to finish

    // Placed (not yet confirmed) orders can't be worked on.
    const placed = (await board(istDay(7))).units.find((u) => u.orderId === s.orders.priced)!;
    expect(placed.state).toBe('waiting');
    await refused(mark(placed.id, 'start'), 409);

    // Late and at-risk: due 30 minutes ago, and due within the at-risk window.
    const pastTime = timeFromNow(-30);
    const soonTime = timeFromNow(85); // kitchen-ready in 10 minutes
    if (pastTime && soonTime) {
      const late = await make(s.a2, pastTime);
      const soon = await make(s.a3, soonTime);
      Object.assign(s.orders, { late: late.id, soon: soon.id });
      s.times.past = pastTime;
      expect((await unitsOf(late.id)).every((u) => u.state === 'late')).toBe(true);
      expect((await unitsOf(soon.id)).every((u) => u.state === 'at-risk')).toBe(true);
    }

    // The board on screen: filter by station, late work stands out.
    await signIn(page, 'kitchen@test.com');
    await page.goto('/kitchen');
    await page.locator('.mantine-SegmentedControl-root').getByText('Unassigned').click();
    const rows = page.getByRole('row').filter({ hasText: `#${x.id}` });
    await expect(rows).toHaveCount(2);
    if (s.orders.late) {
      await expect(
        page
          .getByRole('row')
          .filter({ hasText: `#${s.orders.late}` })
          .first(),
      ).toContainText('Late');
    }
  });

  test('kitchen: changing the delivery time moves the plan with it', async () => {
    test.skip(!s.orders.z, 'kitchen step was skipped');
    const before = await order(s.orders.z);
    await ok(
      put(`/api/orders/${s.orders.z}/delivery`, {
        deliveryTime: '23:30',
        addressId: before.address.id,
        packagingTypeId: before.packagingType?.id ?? null,
      }),
    );
    const after = await order(s.orders.z);
    const deliverAt = instant(istDay(), '23:30');
    expect(after.plan.dispatchReadyBy).toBe(minutesBefore(deliverAt, 45));
    expect(after.plan.kitchenReadyBy).toBe(minutesBefore(deliverAt, 75));
    // Only admins may override, and only with the company's own addresses.
    const dispatch = await as('dispatch@test.com');
    expect(
      (
        await dispatch.put(`/api/orders/${s.orders.z}/delivery`, {
          data: { deliveryTime: '23:00', addressId: before.address.id, packagingTypeId: null },
        })
      ).status(),
    ).toBe(403);
    await refused(
      put(`/api/orders/${s.orders.z}/delivery`, {
        deliveryTime: '23:30',
        addressId: s.addressB,
        packagingTypeId: null,
      }),
      400,
      'addressId',
    );
    // Back to where it was, so it rejoins its drop.
    await ok(
      put(`/api/orders/${s.orders.z}/delivery`, {
        deliveryTime: before.deliveryTime,
        addressId: before.address.id,
        packagingTypeId: before.packagingType?.id ?? null,
      }),
    );
  });

  // ---------- Dispatch and drivers (4.8) ----------

  test('dispatch: drops, step order, drivers, and on-time recorded at delivery', async ({
    page,
  }) => {
    test.skip(!s.orders.x, 'kitchen step was skipped');
    const dispatch = await as('dispatch@test.com');
    const step = (drop: Drop, name: string, ctx = dispatch) =>
      ctx.post('/api/dispatch/step', { data: { drop: drop.ref, step: name } });

    // Same company, address and time: one drop. Other address: its own drop.
    const xy = await dropOf(s.orders.x);
    expect(xy.orders.map((o) => o.id).sort()).toEqual([s.orders.x, s.orders.y].sort());
    expect(xy.company.name).toBe(COMPANY_A);
    expect(xy.driver?.name).toBe('QA Driver'); // the company default
    expect(xy.stage).toBe('kitchen-ready');
    expect(xy.portions).toBe(6);
    const z = await dropOf(s.orders.z);
    expect(z.orders.map((o) => o.id)).toEqual([s.orders.z]);

    // Steps in order only, never twice.
    await refused(step(xy, 'out'), 409);
    await refused(step(xy, 'delivered'), 409);
    await ok(step(xy, 'dispatch-ready'));
    await refused(step(xy, 'dispatch-ready'), 409);

    // Drivers: only active drivers can be assigned, and not after it's left.
    const kitchenUser = (await get<{ id: number; email: string }[]>('/api/staff')).find(
      (u) => u.email === 'kitchen@test.com',
    )!;
    await refused(
      dispatch.post('/api/dispatch/assign', { data: { drop: xy.ref, driverId: kitchenUser.id } }),
      400,
    );
    await ok(
      dispatch.post('/api/dispatch/assign', { data: { drop: xy.ref, driverId: s.qaDriver } }),
    );
    await ok(step(xy, 'out'));
    await refused(
      dispatch.post('/api/dispatch/assign', { data: { drop: xy.ref, driverId: s.qaDriver } }),
      409,
    );

    // The regular test driver doesn't see this drop and can't deliver it.
    const devDriver = await as('driver@test.com');
    const theirs = await ok<Drop[]>(devDriver.get('/api/deliveries'));
    expect(theirs.some((d) => d.company.name === COMPANY_A)).toBe(false);
    await refused(
      devDriver.post('/api/deliveries/delivered', { data: { drop: xy.ref, note: '' } }),
      403,
    );
    // Drivers only see their own deliveries; dispatch screens are off limits.
    expect((await devDriver.get('/api/dispatch/drops')).status()).toBe(403);

    // The QA driver delivers it on a phone, with a note, on time.
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, `qa.driver@${QA_DOMAIN}`);
    await expect(page.getByRole('heading', { name: "Today's deliveries" })).toBeVisible();
    const card = page.locator(`[data-drop="${COMPANY_A} ${xy.ref.time}"]`).first();
    await expect(card).toContainText(xy.address.label);
    await card.getByRole('button', { name: 'Mark delivered' }).click();
    await page.getByLabel('Note (optional)').fill('QA: handed to reception');
    await page.getByRole('button', { name: 'Confirm delivered' }).click();
    await expect(card.getByText('Delivered', { exact: true })).toBeVisible();
    await expect(card.getByText('On time')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);

    const delivered = await order(s.orders.x);
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.deliveredOnTime).toBe(true);
    expect(delivered.deliveryNote).toBe('QA: handed to reception');
    const qaDriver = await as(`qa.driver@${QA_DOMAIN}`);
    await refused(
      qaDriver.post('/api/deliveries/delivered', { data: { drop: xy.ref, note: '' } }),
      409,
    );
    // Only today's deliveries can be marked from the driver view.
    await refused(
      qaDriver.post('/api/deliveries/delivered', {
        data: { drop: { ...xy.ref, date: istDay(1) }, note: '' },
      }),
      400,
    );
    // Their list is theirs alone, in time order.
    const mine = await ok<Drop[]>(qaDriver.get('/api/deliveries'));
    expect(mine.every((d) => d.driver?.id === s.qaDriver)).toBe(true);
    const times = mine.map((d) => d.ref.time);
    expect(times).toEqual([...times].sort());

    // "Out" needs a driver: company B has no default driver.
    const bOrder = await placeOrder({
      employeeId: s.b1,
      deliveryDate: istDay(),
      deliveryTime: s.times.later,
      lines: [
        {
          dishId: s.rajma!.id,
          quantity: 1,
          combos: [{ quantity: 1, optionIds: firstChoices(s.rajma!) }],
        },
      ],
    });
    s.orders.b = bOrder.id;
    await ok(post(`/api/kitchen/orders/${bOrder.id}/complete`));
    const bDrop = await dropOf(bOrder.id);
    expect(bDrop.driver).toBeNull();
    await ok(step(bDrop, 'dispatch-ready'));
    expect(await refused(step(bDrop, 'out'), 409)).toContain('Assign a driver first');
  });

  test('dispatch: a drop that misses its time shows as late, and is recorded late', async () => {
    test.skip(!s.orders.late, 'needs a delivery time earlier today');
    const dispatch = await as('dispatch@test.com');
    let drop = await dropOf(s.orders.late);
    expect(drop.late).toBe(true); // not out by its planned dispatch time
    await ok(post(`/api/kitchen/orders/${s.orders.late}/complete`));
    for (const name of ['dispatch-ready', 'out']) {
      await ok(dispatch.post('/api/dispatch/step', { data: { drop: drop.ref, step: name } }));
    }
    const qaDriver = await as(`qa.driver@${QA_DOMAIN}`);
    await ok(
      qaDriver.post('/api/deliveries/delivered', { data: { drop: drop.ref, note: 'QA late' } }),
    );
    drop = await dropOf(s.orders.late);
    expect(drop.stage).toBe('delivered');
    expect(drop.deliveredOnTime).toBe(false);
    expect(drop.late).toBe(true);
    expect((await order(s.orders.late)).deliveredOnTime).toBe(false);
  });

  // ---------- Order list and detail (4.6) ----------

  test('order list: date range, status, company, invoiced, search and pages, all on the server', async ({
    page,
  }) => {
    const mine = await allOrders(`companyId=${s.companyA}`);
    // The draft, two placed orders and tomorrow's always exist; today's only before 8 pm IST.
    expect(mine.length).toBeGreaterThanOrEqual(4);
    expect(mine.every((o) => o.company.name === COMPANY_A)).toBe(true);

    const today = await allOrders(`companyId=${s.companyA}&from=${istDay()}&to=${istDay()}`);
    expect(today.every((o) => o.deliveryDate === istDay())).toBe(true);
    const week = await allOrders(`companyId=${s.companyA}&from=${istDay(1)}&to=${istDay(7)}`);
    expect(week.map((o) => o.id)).toEqual(
      expect.arrayContaining([s.orders.priced, s.orders.fresh, s.orders.tomorrow]),
    );
    expect(week.map((o) => o.id)).not.toContain(s.orders.x);

    const drafts = await allOrders(`companyId=${s.companyA}&status=DRAFT`);
    expect(drafts.map((o) => o.id)).toEqual([s.orders.draft]);
    const notInvoiced = await allOrders(`companyId=${s.companyA}&invoiced=no`);
    expect(notInvoiced.length).toBe(mine.length); // nothing invoiced yet

    const search = await get<OrderPage>('/api/orders?q=QA%20Rules%20One');
    expect(search.items.every((o) => o.employee.name === 'QA Rules One')).toBe(true);
    const byNumber = await get<OrderPage>(`/api/orders?q=%23${s.orders.x}`);
    expect(byNumber.items.map((o) => o.id)).toEqual([s.orders.x]);

    // Pages: 20 at a time, no repeats between pages.
    const page1 = await get<OrderPage>('/api/orders?page=1');
    const page2 = await get<OrderPage>('/api/orders?page=2');
    expect(page1.pageSize).toBe(20);
    expect(page1.items).toHaveLength(20);
    const ids1 = new Set(page1.items.map((o) => o.id));
    expect(page2.items.some((o) => ids1.has(o.id))).toBe(false);
    await refused(admin.get('/api/orders?from=not-a-date'), 400);

    // The detail page: lines, choices, money and the whole timeline.
    test.skip(!s.orders.x, 'kitchen step was skipped');
    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${s.orders.x}`);
    for (const label of [
      'Created',
      'Placed',
      'Confirmed',
      'Kitchen started',
      'Kitchen ready',
      'Ready for dispatch',
      'Out for delivery',
      'Delivered',
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText('QA: handed to reception')).toBeVisible();
    await expect(page.getByRole('row', { name: /Order total/ })).toBeVisible();
  });

  // ---------- Billing (4.9) ----------

  test('billing: unbilled list, invoices, totals, paid, and what can never be invoiced', async ({
    page,
  }) => {
    test.skip(!s.orders.x, 'kitchen step was skipped');
    // Exactly the confirmed and delivered orders, not yet invoiced.
    const billing = () => get<CompanyBilling>(`/api/billing/companies/${s.companyA}`);
    const first = await billing();
    const billable = [
      ...(await allOrders(`companyId=${s.companyA}&status=CONFIRMED&invoiced=no`)),
      ...(await allOrders(`companyId=${s.companyA}&status=DELIVERED&invoiced=no`)),
    ];
    expect(first.unbilledOrders.map((o) => o.id).sort()).toEqual(billable.map((o) => o.id).sort());
    expect(first.unbilledOrders.map((o) => o.id)).not.toContain(s.orders.priced); // only placed
    expect(first.unbilledOrders.map((o) => o.id)).not.toContain(s.orders.draft);
    const summary = (await get<BillingCompany[]>('/api/billing/companies')).find(
      (c) => c.id === s.companyA,
    )!;
    expect(summary.unbilledOrders).toBe(billable.length);
    expect(summary.unbilledAmount).toBe(billable.reduce((sum, o) => sum + o.total, 0));

    // Never invoiceable: a placed order, a draft, another company's order.
    const invoice = (orderIds: number[], adjustmentIds: number[] = [], companyId = s.companyA) =>
      post('/api/billing/invoices', { companyId, orderIds, adjustmentIds });
    await refused(invoice([s.orders.priced]), 409);
    await refused(invoice([s.orders.draft]), 409);
    await refused(invoice([s.orders.b]), 409);
    await refused(invoice([]), 400);

    // Invoice X and Y: the stored total is exactly their sum.
    const inv1 = await ok<{ id: number; total: number }>(invoice([s.orders.x, s.orders.y]));
    const x = await order(s.orders.x);
    const y = await order(s.orders.y);
    expect(inv1.total).toBe(x.total + y.total);
    await refused(invoice([s.orders.x]), 409); // at most one invoice per order
    expect((await order(s.orders.x)).invoice?.id).toBe(inv1.id);
    const invoiced = await allOrders(`companyId=${s.companyA}&invoiced=yes`);
    expect(invoiced.map((o) => o.id).sort()).toEqual([s.orders.x, s.orders.y].sort());

    // Paid once, not twice.
    await ok(post(`/api/billing/invoices/${inv1.id}/paid`));
    await refused(post(`/api/billing/invoices/${inv1.id}/paid`), 409);
    const paid = await get<InvoiceDetail>(`/api/billing/invoices/${inv1.id}`);
    expect(paid.paidAt).not.toBeNull();
    expect(paid.total).toBe(inv1.total); // never recalculated

    // A short delivery on a delivered, paid order: credited, capped at its cost.
    const tooMuch = await refused(
      post(`/api/billing/orders/${s.orders.x}/credit`, { amount: x.total + 1, reason: 'QA over' }),
      400,
      'amount',
    );
    expect(tooMuch).toMatch(/^At most ₹[\d,]+\.\d\d can still be credited/);
    await ok(
      post(`/api/billing/orders/${s.orders.x}/credit`, { amount: 1000, reason: 'QA short' }),
    );
    await refused(
      post(`/api/billing/orders/${s.orders.x}/credit`, { amount: x.total, reason: 'QA again' }),
      400,
    );

    // Z invoiced, part-credited, then cancelled: credited the rest, never more.
    const inv2 = await ok<{ id: number; total: number }>(invoice([s.orders.z]));
    const z = await order(s.orders.z);
    expect(inv2.total).toBe(z.total);
    await ok(post(`/api/billing/orders/${s.orders.z}/credit`, { amount: 500, reason: 'QA part' }));
    await ok(post(`/api/orders/${s.orders.z}/cancel`));
    const cancelled = await order(s.orders.z);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.adjustments.reduce((sum, a) => sum + a.amount, 0)).toBe(-z.total);
    expect((await get<InvoiceDetail>(`/api/billing/invoices/${inv2.id}`)).total).toBe(z.total);
    await refused(
      post(`/api/billing/orders/${s.orders.z}/credit`, { amount: 1, reason: 'QA dead' }),
      409,
    );

    // Tomorrow's confirmed order: invoiced, then rejected (kitchen hasn't started).
    const inv3 = await ok<{ id: number }>(invoice([s.orders.tomorrow]));
    await ok(post(`/api/orders/${s.orders.tomorrow}/reject`, { reason: 'QA out of stock' }));
    const rejected = await order(s.orders.tomorrow);
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.adjustments.map((a) => [a.amount, a.reason])).toEqual([
      [-rejected.total, 'Rejected after invoicing: QA out of stock'],
    ]);
    expect(rejected.invoice?.id).toBe(inv3.id);
    // A cooked order can't be rejected.
    await refused(post(`/api/orders/${s.orders.y}/reject`, { reason: 'QA too late' }), 409);

    // Everything still owed goes on one last invoice, and it reconciles.
    const rest = await billing();
    const credits = rest.unbilledCredits;
    expect(credits.map((c) => c.reason)).toEqual(
      expect.arrayContaining([
        'QA short',
        'QA part',
        'Cancelled after invoicing',
        'Rejected after invoicing: QA out of stock',
      ]),
    );
    const owed =
      rest.unbilledOrders.reduce((sum, o) => sum + o.total, 0) +
      credits.reduce((sum, c) => sum + c.amount, 0);
    const inv4 = await ok<{ id: number; total: number }>(
      invoice(
        rest.unbilledOrders.map((o) => o.id),
        credits.map((c) => c.id),
      ),
    );
    expect(inv4.total).toBe(owed);
    const detail = await get<InvoiceDetail>(`/api/billing/invoices/${inv4.id}`);
    expect(detail.total).toBe(
      detail.orders.reduce((sum, o) => sum + o.total, 0) +
        detail.credits.reduce((sum, c) => sum + c.amount, 0),
    );
    const done = await billing();
    expect(done.unbilledOrders).toHaveLength(0);
    expect(done.unbilledCredits).toHaveLength(0);

    // The company's whole history adds up: every invoice total is what the
    // orders on it cost, plus its credits.
    for (const inv of done.invoices) {
      const full = await get<InvoiceDetail>(`/api/billing/invoices/${inv.id}`);
      expect(full.total, `invoice #${inv.id}`).toBe(
        full.orders.reduce((sum, o) => sum + o.total, 0) +
          full.credits.reduce((sum, c) => sum + c.amount, 0),
      );
    }

    // The invoice as staff see it.
    await signIn(page, 'admin@test.com');
    await page.goto(`/invoices/${inv4.id}`);
    await expect(page.getByText('Credit on #' + s.orders.z).first()).toBeVisible();
    await page.goto(`/billing/${s.companyA}`);
    await expect(page.getByText('Everything is invoiced.')).toBeVisible();
    await expect(
      page.getByRole('row', { name: new RegExp(`Invoice #${inv1.id}\\b`) }),
    ).toContainText('Paid');

    // Only admins see billing.
    const dispatch = await as('dispatch@test.com');
    expect((await dispatch.get(`/api/billing/companies/${s.companyA}`)).status()).toBe(403);
  });

  test('billing: a cancel and an invoice at the same moment never lose the credit', async () => {
    for (let round = 0; round < 3; round++) {
      const target = await placeOrder({
        employeeId: s.a2,
        deliveryDate: istDay(1),
        deliveryTime: `12:4${round}`,
        lines: [thaliLine([{ quantity: 3, optionIds: [s.raita] }])],
      });
      expect(target.status).toBe('CONFIRMED');
      const [cancel, invoice] = await Promise.all([
        post(`/api/orders/${target.id}/cancel`),
        post('/api/billing/invoices', { companyId: s.companyA, orderIds: [target.id] }),
      ]);
      expect(cancel.ok(), await cancel.text()).toBe(true);
      expect([201, 409]).toContain(invoice.status());
      const detail = await order(target.id);
      expect(detail.status).toBe('CANCELLED');
      const credited = detail.adjustments.reduce((sum, a) => sum + a.amount, 0);
      expect(credited).toBe(invoice.status() === 201 ? -detail.total : 0);
    }
  });

  // ---------- Dashboards (4.11) ----------

  test('the admin dashboard agrees with the order list and the billing page', async () => {
    const dash = await get<AdminDashboard>('/api/dashboard/admin');
    const today = [
      ...(await allOrders(`from=${istDay()}&to=${istDay()}&status=CONFIRMED`)),
      ...(await allOrders(`from=${istDay()}&to=${istDay()}&status=DELIVERED`)),
    ];
    expect(dash.today.date).toBe(istDay());
    expect(dash.today.orders).toBe(today.length);
    expect(dash.today.value).toBe(today.reduce((sum, o) => sum + o.total, 0));
    expect(dash.today.delivered).toBe(today.filter((o) => o.status === 'DELIVERED').length);

    const companies = await get<BillingCompany[]>('/api/billing/companies');
    expect(dash.money.unbilled).toBe(companies.reduce((sum, c) => sum + c.unbilledAmount, 0));
    expect(dash.money.unpaid).toBe(companies.reduce((sum, c) => sum + c.unpaidAmount, 0));
    expect(dash.money.unpaidInvoices).toBe(companies.reduce((sum, c) => sum + c.unpaidInvoices, 0));

    const drafts = await allOrders(`from=${istDay(1)}&to=${istDay(7)}&status=DRAFT`);
    expect(dash.upcoming.drafts).toBe(drafts.length);
    const tiers = await get<Tier[]>('/api/tiers');
    for (const tier of dash.tiersMissingPrices) {
      expect(tiers.find((t) => t.name === tier.name)!.missingDishes).toBe(tier.missing);
    }

    // Each role lands on its own dashboard, and only admins get this one.
    for (const email of ['kitchen@test.com', 'dispatch@test.com', 'driver@test.com']) {
      const ctx = await as(email);
      expect((await ctx.get('/api/dashboard/admin')).status(), email).toBe(403);
    }
  });
});
