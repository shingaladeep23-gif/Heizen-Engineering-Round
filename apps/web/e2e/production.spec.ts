// The full business journey, run against the live site:
//   BASE_URL=https://fernleaf.vercel.app npx playwright test e2e/production.spec.ts
//
// It only creates data for one clearly labelled internal company,
// "Fernleaf QA (test client)", so the demo companies reviewers look at are
// never touched. Tests run in order and build on each other.
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { isLive, PASSWORD, signIn } from './helpers';

const QA_COMPANY = 'Fernleaf QA (test client)';
const QA_DOMAIN = 'fernleaf-qa.in';
const QA_EMPLOYEE = 'QA Tester';

const pad = (n: number) => String(n).padStart(2, '0');
const istNow = () => new Date(Date.now() + 330 * 60_000);
const dayIST = (plus = 0) =>
  new Date(Date.now() + 330 * 60_000 + plus * 86_400_000).toISOString().slice(0, 10);
// A delivery time later today (so a delivery now counts as on time), with a
// random minute so this run gets a drop of its own.
const laterToday = () =>
  `${pad(Math.min(istNow().getUTCHours() + 2, 23))}:${pad(Math.floor(Math.random() * 60))}`;
const randomTime = () =>
  `${pad(8 + Math.floor(Math.random() * 12))}:${pad(Math.floor(Math.random() * 60))}`;
// The smallest valid PNG, standing in for a phone photo.
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let api: APIRequestContext;
let qa: { companyId: number; employeeId: number; addressId: number };
// Filled in as the journey goes.
const made: { confirmed?: number; today?: number; todayTime?: string; invoice?: number } = {};

async function as(email: string) {
  const ctx = await request.newContext({ baseURL: process.env.BASE_URL });
  const res = await ctx.post('/api/auth/login', { data: { email, password: PASSWORD } });
  expect(res.ok()).toBe(true);
  return ctx;
}

async function order(body: Record<string, unknown>) {
  const res = await api.post('/api/orders', {
    data: {
      employeeId: qa.employeeId,
      lines: [{ dishId: 3, quantity: 2, combos: [{ quantity: 2, optionIds: [5] }] }],
      place: true,
      ...body,
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id: number; status: string };
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: new RegExp(`^${option}`) }).click();
}

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.describe('production journey', () => {
  test.skip(!isLive, 'runs against the live site only (BASE_URL=...)');

  test.beforeAll(async () => {
    api = await as('admin@test.com');
    // Make sure the QA company and its one employee exist (idempotent).
    const companies: { id: number; name: string }[] = await (
      await api.get('/api/companies')
    ).json();
    let company = companies.find((c) => c.name === QA_COMPANY);
    if (!company) {
      const drivers: { id: number; name: string }[] = await (
        await api.get('/api/dispatch/drivers')
      ).json();
      const res = await api.post('/api/companies', {
        data: {
          name: QA_COMPANY,
          domains: [QA_DOMAIN],
          addresses: [
            { label: 'QA desk', text: 'Internal test account, not a real delivery address' },
          ],
          billingName: 'Fernleaf QA',
          billingEmail: `billing@${QA_DOMAIN}`,
          workingDays: [1, 2, 3, 4, 5, 6, 7],
          deliveryTime: '12:00',
          dispatchLeadMinutes: 60,
          driverInstructions: 'Test drop: used by automated checks.',
          defaultDriverId: drivers.find((d) => d.name === 'Dev Driver')?.id ?? null,
        },
      });
      expect(res.ok(), await res.text()).toBe(true);
      company = await res.json();
    }
    let detail = await (await api.get(`/api/companies/${company!.id}`)).json();
    if (!detail.employees.some((e: { name: string }) => e.name === QA_EMPLOYEE)) {
      const res = await api.post('/api/employees', {
        data: {
          companyId: company!.id,
          name: QA_EMPLOYEE,
          email: `qa.tester@${QA_DOMAIN}`,
          canChooseAddress: true,
          canChangeTime: true,
          canChangePackaging: true,
        },
      });
      expect(res.ok(), await res.text()).toBe(true);
      detail = await (await api.get(`/api/companies/${company!.id}`)).json();
    }
    qa = {
      companyId: company!.id,
      employeeId: detail.employees.find((e: { name: string }) => e.name === QA_EMPLOYEE).id,
      addressId: detail.addresses[0].id,
    };
  });

  test('catalogue screens load: dishes, a dish, options, menu, tiers, lists', async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/dishes');
    await expect(page.getByRole('cell', { name: 'Paneer Tikka Rice Bowl' })).toBeVisible();
    await expect(page.getByText('Deactivated')).toBeVisible(); // the retired Ragi Brownie
    await page.getByRole('cell', { name: 'Paneer Tikka Rice Bowl' }).click();
    await expect(page.getByLabel('Group name').first()).toHaveValue('Choose your rice');
    await page.goto('/options');
    await expect(page.getByRole('cell', { name: 'Jeera rice' })).toBeVisible();
    await page.goto('/menu');
    await expect(page.getByRole('heading', { name: "Chef's Specials" })).toBeVisible();
    await page.goto('/lists');
    await expect(page.getByText('Kitchen stations')).toBeVisible();
    await page.goto('/tiers');
    await expect(page.getByText('Standard − 10%')).toBeVisible();
    await page.getByText('Partner', { exact: true }).click();
    await expect(page.getByRole('row', { name: /Paneer Tikka Rice Bowl/ })).toContainText(
      '₹169.00',
    );
  });

  test("the menu preview shows the QA tester's menu on the default tier", async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/preview');
    await page.getByRole('combobox', { name: 'Employee' }).fill(QA_EMPLOYEE);
    await page.getByRole('option', { name: new RegExp(QA_EMPLOYEE) }).click();
    await expect(page.getByText('priced on the Standard tier')).toBeVisible();
    const bowl = page.locator('.mantine-Card-root', { hasText: 'Paneer Tikka Rice Bowl' });
    await expect(bowl).toContainText('₹220.00');
  });

  test('an admin places an order in the form, with two combinations', async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/orders/new');
    await page.getByRole('combobox', { name: 'Employee' }).fill(QA_EMPLOYEE);
    await page.getByRole('option', { name: new RegExp(QA_EMPLOYEE) }).click();
    await page.getByLabel('Delivery date').fill(dayIST(1)); // tomorrow: cut-off passed
    await expect(page.getByText(/The cut-off was/)).toBeVisible();
    await page.getByLabel('Delivery time').fill(randomTime());

    await page.getByRole('button', { name: 'Add Paneer Tikka Rice Bowl' }).click();
    await page.getByLabel('Paneer Tikka Rice Bowl quantity').fill('5');
    await page.getByLabel('Paneer Tikka Rice Bowl combination 1 quantity').fill('3');
    await pick(page, 'Paneer Tikka Rice Bowl combination 1 Choose your rice', 'Brown rice');
    await page.getByRole('button', { name: 'Add combination' }).click();
    await page.getByLabel('Paneer Tikka Rice Bowl combination 2 quantity').fill('2');
    await pick(page, 'Paneer Tikka Rice Bowl combination 2 Choose your rice', 'Jeera rice');
    await expect(page.getByText('3 + 2 of 5 assigned')).toBeVisible();
    // Standard tier: 3 x (220 + 25) + 2 x (220 + 20) = 735 + 480 = 1,215
    await expect(page.getByRole('heading', { name: 'Total ₹1,215.00' })).toBeVisible();
    await page.getByRole('button', { name: 'Place order' }).click();

    await expect(page).toHaveURL(/\/orders\/\d+$/);
    made.confirmed = Number(page.url().split('/').pop());
    // Placed after the cut-off by an admin, so it's confirmed straight away.
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('row', { name: /Order total/ })).toContainText('₹1,215.00');
    await expect(page.getByText('Brown rice (+₹25.00)')).toBeVisible();
    await expect(page.getByText('Dev Driver')).toBeVisible(); // the company's default driver
  });

  test('a draft is placed, edited and cancelled before its cut-off', async ({ page }) => {
    const draft = await order({
      deliveryDate: dayIST(7),
      deliveryTime: randomTime(),
      place: false,
    });
    expect(draft.status).toBe('DRAFT');
    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${draft.id}`);
    await expect(page.getByText(/^Cut-off/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByText('Placed', { exact: true }).first()).toBeVisible();

    await page.getByRole('link', { name: 'Edit' }).click();
    await page.getByLabel('Rajma Chawal Bowl quantity').fill('3');
    await page.getByLabel('Rajma Chawal Bowl combination 1 quantity').fill('3');
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${draft.id}$`));
    await expect(page.getByRole('row', { name: /Rajma Chawal Bowl/ }).first()).toContainText('3');

    await page.getByRole('button', { name: 'Cancel order' }).click();
    await page.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
  });

  test('an admin rejects an order and changes delivery details on another', async ({ page }) => {
    const toReject = await order({ deliveryDate: dayIST(1), deliveryTime: randomTime() });
    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${toReject.id}`);
    await page.getByRole('button', { name: 'Reject' }).click();
    await page.getByLabel('Reason').fill('Automated check: kitchen out of stock');
    await page.getByRole('button', { name: 'Reject order' }).click();
    await expect(page.getByText(/Rejected: Automated check/).first()).toBeVisible();

    await page.goto(`/orders/${made.confirmed}`);
    await page.getByRole('button', { name: 'Change delivery' }).click();
    await page.getByLabel('Delivery time').fill('13:45');
    await page.getByRole('button', { name: 'Save delivery details' }).click();
    await expect(page.getByText(/, 13:45$/)).toBeVisible();
    // The plan moves with it: leaves at 12:45, cooked by 12:15.
    await expect(page.getByText('12:15 pm')).toBeVisible();
  });

  test('the kitchen cooks today’s order unit by unit', async ({ page }) => {
    made.todayTime = laterToday();
    const today = await order({
      deliveryDate: dayIST(0),
      deliveryTime: made.todayTime,
      lines: [
        {
          dishId: 1,
          quantity: 3,
          combos: [
            { quantity: 2, optionIds: [6] },
            { quantity: 1, optionIds: [5] },
          ],
        },
      ],
    });
    made.today = today.id;
    expect(today.status).toBe('CONFIRMED');

    await signIn(page, 'kitchen@test.com');
    await page.goto('/kitchen');
    const rows = page.getByRole('row').filter({ hasText: `#${today.id}` });
    await expect(rows).toHaveCount(2);
    await rows.filter({ hasText: 'Brown rice' }).getByRole('button', { name: 'Start' }).click();
    await expect(
      rows.filter({ hasText: 'Brown rice' }).getByRole('button', { name: 'Start' }),
    ).toHaveCount(0);
    for (const choice of ['Brown rice', 'Jeera rice']) {
      await rows.filter({ hasText: choice }).getByRole('button', { name: 'Done' }).click();
      // The Done button disappears only once the server has saved it.
      await expect(
        rows.filter({ hasText: choice }).getByRole('button', { name: 'Done' }),
      ).toHaveCount(0);
    }
    await page.goto(`/orders/${today.id}`);
    await expect(page.getByText('Kitchen ready', { exact: true })).toBeVisible();
  });

  test('dispatch sends the drop out with its driver', async ({ page }) => {
    await signIn(page, 'dispatch@test.com');
    await page.goto('/dispatch');
    const drop = page.locator(`[data-drop="${QA_COMPANY} ${made.todayTime}"]`);
    await expect(drop).toContainText(`#${made.today}`);
    await expect(drop.getByRole('combobox', { name: /Driver for/ })).toHaveValue('Dev Driver');
    await drop.getByRole('button', { name: 'Mark ready to go' }).click();
    await expect(drop.getByText('Ready to go', { exact: true })).toBeVisible();
    await drop.getByRole('button', { name: 'Send out for delivery' }).click();
    await expect(drop.getByText('Out for delivery', { exact: true })).toBeVisible();
  });

  test('the driver delivers it on a phone, with a note and a photo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'driver@test.com');
    await expect(page.getByRole('heading', { name: "Today's deliveries" })).toBeVisible();
    const drop = page.locator(`[data-drop="${QA_COMPANY} ${made.todayTime}"]`);
    await drop.getByRole('button', { name: 'Mark delivered' }).click();
    await page.getByLabel('Note (optional)').fill('Automated check: left at the QA desk');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'proof.png',
      mimeType: 'image/png',
      buffer: PHOTO,
    });
    await page.getByRole('button', { name: 'Confirm delivered' }).click();
    await expect(drop.getByText('Delivered', { exact: true })).toBeVisible();
    await expect(drop.getByText('On time')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);

    // The admin sees the note and the photo on the order.
    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${made.today}`);
    await expect(page.getByText('Automated check: left at the QA desk')).toBeVisible();
    await expect(page.getByAltText('Proof of delivery')).toBeVisible();
    await expect(page.getByText('Delivered on time')).toBeVisible();
  });

  test('billing: invoice everything unbilled, check the total, mark it paid', async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/billing');
    await page.getByRole('cell', { name: QA_COMPANY }).click();
    await expect(page.getByRole('link', { name: `#${made.today}` })).toBeVisible();
    await expect(page.getByRole('link', { name: `#${made.confirmed}` })).toBeVisible();
    await page.getByRole('button', { name: 'Create invoice' }).click();
    await expect(page).toHaveURL(/\/invoices\/\d+$/);
    made.invoice = Number(page.url().split('/').pop());

    // The stored total is exactly the sum of its orders and credits.
    const invoice = await (await api.get(`/api/billing/invoices/${made.invoice}`)).json();
    const sum =
      invoice.orders.reduce((s: number, o: { total: number }) => s + o.total, 0) +
      invoice.credits.reduce((s: number, c: { amount: number }) => s + c.amount, 0);
    expect(invoice.total).toBe(sum);
    expect(invoice.orders.map((o: { id: number }) => o.id)).toEqual(
      expect.arrayContaining([made.today, made.confirmed]),
    );

    await page.goto(`/billing/${qa.companyId}`);
    await expect(page.getByText('Everything is invoiced.')).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(`Invoice #${made.invoice}\\b`) });
    await row.getByRole('button', { name: 'Mark paid' }).click();
    await expect(row.getByText('Paid', { exact: true })).toBeVisible();
    await page.goto(`/orders/${made.today}`);
    await expect(page.getByText(`Invoice #${made.invoice}`)).toBeVisible();
  });

  test('an order can never be invoiced twice, even with simultaneous requests', async () => {
    const fresh = await order({ deliveryDate: dayIST(1), deliveryTime: randomTime() });
    const body = { companyId: qa.companyId, orderIds: [fresh.id] };
    const results = await Promise.all(
      [1, 2].map(() => api.post('/api/billing/invoices', { data: body })),
    );
    expect(results.map((r) => r.status()).sort()).toEqual([201, 409]);
  });

  test('a short delivery is credited, and a credit note is invoiced on its own', async ({
    page,
  }) => {
    const shortOrder = await order({ deliveryDate: dayIST(1), deliveryTime: randomTime() });
    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${shortOrder.id}`);
    await page.getByRole('button', { name: 'Credit short delivery' }).click();
    await page.getByLabel('Amount to credit').fill('50');
    await page.getByLabel('Reason').fill('Automated check: one box short');
    await page.getByRole('button', { name: 'Record credit' }).click();
    await expect(page.getByRole('row', { name: /one box short/ })).toContainText('-₹50.00');

    // Invoice just the credit (untick the order itself).
    await page.goto(`/billing/${qa.companyId}`);
    await page.getByRole('checkbox', { name: `Include order #${shortOrder.id}` }).uncheck();
    await expect(page.getByText('Invoice total -₹50.00')).toBeVisible();
    await page.getByRole('button', { name: 'Create invoice' }).click();
    await expect(page.getByText('Credit on #' + shortOrder.id)).toBeVisible();
    await expect(page.getByRole('row', { name: /^Total/ })).toContainText('-₹50.00');
  });

  test('cancelling an invoiced order credits it on the next invoice', async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${made.confirmed}`);
    await page.getByRole('button', { name: 'Cancel order' }).click();
    await expect(page.getByText(/already invoiced, so a credit/)).toBeVisible();
    await page.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(page.getByText('Adjustment: Cancelled after invoicing')).toBeVisible();
    await expect(page.getByRole('row', { name: /Cancelled after invoicing/ })).toContainText(
      '-₹1,215.00',
    );
    await page.goto(`/billing/${qa.companyId}`);
    await expect(page.getByText('Credit: Cancelled after invoicing').first()).toBeVisible();
  });

  test('two people cancelling the same order at once: one wins', async () => {
    const target = await order({
      deliveryDate: dayIST(7),
      deliveryTime: randomTime(),
      place: false,
    });
    const results = await Promise.all(
      [1, 2, 3].map(() => api.post(`/api/orders/${target.id}/cancel`)),
    );
    expect(results.map((r) => r.status()).sort()).toEqual([200, 409, 409]);
  });

  test('order list: search, filters and pages', async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/orders');
    await expect(page.getByText(/\d+ orders/)).toBeVisible(); // more than one page of demo orders
    await page.getByLabel('Search').fill(`#${made.today}`);
    await expect(page.getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('cell', { name: `#${made.today}`, exact: true })).toBeVisible();
    await page.getByLabel('Search').fill('');
    await page.getByRole('combobox', { name: 'Status' }).click();
    await page.getByRole('option', { name: 'Rejected' }).click();
    await expect(page.getByRole('cell', { name: 'Rejected' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Delivered' })).toHaveCount(0);
  });

  test('running the cut-off for a past date is allowed and changes nothing twice', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/orders');
    await page.getByRole('button', { name: 'Run cut-off' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Delivery date').fill(dayIST(-1));
    await dialog.getByRole('button', { name: 'Run cut-off' }).click();
    await expect(dialog.getByText(/confirmed, \d+ drafts cancelled/)).toBeVisible();
    // Again: nothing left to do, so nothing changes.
    await dialog.getByRole('button', { name: 'Run cut-off' }).click();
    await expect(dialog.getByText(/0 confirmed, 0 drafts cancelled/)).toBeVisible();
  });

  test('every dashboard loads with real figures', async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible();
    await expect(page.getByText(/^Last 7 days/)).toBeVisible();
    await expect(page.getByText('Most ordered, last 7 days')).toBeVisible();
    await expect(page.getByText(/have no price on Startup/)).toBeVisible();

    await signIn(page, 'kitchen@test.com');
    await expect(page.getByRole('heading', { name: 'Kitchen dashboard' })).toBeVisible();
    await expect(page.getByText('Prep list: still to cook today')).toBeVisible();

    await signIn(page, 'dispatch@test.com');
    await expect(page.getByRole('heading', { name: 'Dispatch dashboard' })).toBeVisible();
    await expect(page.getByText('Drivers today')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Dev Driver' })).toBeVisible();
  });

  test('companies, employees, staff and settings screens', async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/companies');
    await expect(page.getByRole('cell', { name: 'Orbit Health' })).toBeVisible();
    await page.getByRole('cell', { name: QA_COMPANY }).click();
    await page
      .getByLabel('Standing instructions for the driver')
      .fill(`Test drop, checked ${dayIST(0)}`);
    await page.getByRole('button', { name: 'Save company' }).click();
    await expect(page.getByText('Company saved')).toBeVisible();
    await expect(page.getByRole('cell', { name: `qa.tester@${QA_DOMAIN}` })).toBeVisible();

    await page.goto('/staff');
    await expect(page.getByRole('cell', { name: 'driver@test.com' })).toBeVisible();
    await page.goto('/settings');
    await expect(page.getByLabel('Cut-off time')).toHaveValue(/\d\d:\d\d/);
  });

  test('each role only reaches its own part of the API', async () => {
    const forbidden: Record<string, [string, string][]> = {
      'kitchen@test.com': [
        ['GET', '/api/billing/companies'],
        ['GET', '/api/settings'],
        ['POST', '/api/orders'],
        ['POST', '/api/dispatch/step'],
        ['GET', '/api/staff'],
      ],
      'dispatch@test.com': [
        ['GET', '/api/dashboard/admin'],
        ['POST', '/api/kitchen/units/1/done'],
        ['PUT', '/api/tiers/1/prices'],
        ['POST', '/api/billing/invoices'],
      ],
      'driver@test.com': [
        ['GET', '/api/orders'],
        ['GET', '/api/kitchen'],
        ['GET', '/api/dispatch/drops'],
        ['GET', '/api/companies/1'],
      ],
    };
    for (const [email, calls] of Object.entries(forbidden)) {
      const ctx = await as(email);
      for (const [method, path] of calls) {
        const res = await ctx.fetch(path, { method, data: method === 'GET' ? undefined : {} });
        expect(res.status(), `${email} ${method} ${path}`).toBe(403);
      }
    }
    const anonymous = await request.newContext({ baseURL: process.env.BASE_URL });
    expect((await anonymous.get('/api/orders')).status()).toBe(401);
  });
});
