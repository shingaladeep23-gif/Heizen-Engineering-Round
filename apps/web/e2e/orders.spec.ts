import { expect, test, type Page } from '@playwright/test';
import {
  apiSignIn,
  createOrder,
  isLive,
  LOCAL_ONLY,
  lockedDate,
  nextSaturday,
  openDate,
  signIn,
} from './helpers';

async function startOrder(page: Page, employee: string, date: string) {
  await page.goto('/orders/new');
  await page.getByRole('combobox', { name: 'Employee' }).fill(employee);
  await page.getByRole('option', { name: new RegExp(employee) }).click();
  await page.getByLabel('Delivery date').fill(date);
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: new RegExp(`^${option}`) }).click();
}

test.describe('placing orders', () => {
  test.skip(isLive, LOCAL_ONLY);

  test('an admin places an order with combinations and sees the breakdown', async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await startOrder(page, 'Priya Raman', openDate());
    await expect(page.getByText(/^Cut-off:/)).toBeVisible();

    // The spec's own example: 10 bowls, 6 with brown rice and 4 with jeera rice.
    await page.getByRole('button', { name: 'Add Paneer Tikka Rice Bowl' }).click();
    await page.getByLabel('Paneer Tikka Rice Bowl quantity').fill('10');
    await page.getByLabel('Paneer Tikka Rice Bowl combination 1 quantity').fill('6');
    await pick(page, 'Paneer Tikka Rice Bowl combination 1 Choose your rice', 'Brown rice');
    await page.getByRole('button', { name: 'Add combination' }).click();
    await page.getByLabel('Paneer Tikka Rice Bowl combination 2 quantity').fill('4');
    await pick(page, 'Paneer Tikka Rice Bowl combination 2 Choose your rice', 'Jeera rice');
    await expect(page.getByText('6 + 4 of 10 assigned')).toBeVisible();

    // Enterprise tier: 6 x (198 + 22.50) + 4 x (198 + 18) = 1,323 + 864 = 2,187
    await expect(page.getByRole('heading', { name: 'Total ₹2,187.00' })).toBeVisible();
    await page.getByRole('button', { name: 'Place order' }).click();

    await expect(page).toHaveURL(/\/orders\/\d+$/);
    await expect(page.getByText('Placed', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('row', { name: /Order total/ })).toContainText('₹2,187.00');
    await expect(page.getByText('Brown rice (+₹22.50)')).toBeVisible();
  });

  test('the server rejects combinations that do not add up', async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await startOrder(page, 'Priya Raman', openDate());
    await page.getByRole('button', { name: 'Add Paneer Tikka Rice Bowl' }).click();
    await page.getByLabel('Paneer Tikka Rice Bowl quantity').fill('10');
    await page.getByLabel('Paneer Tikka Rice Bowl combination 1 quantity').fill('6');
    await pick(page, 'Paneer Tikka Rice Bowl combination 1 Choose your rice', 'Brown rice');
    await expect(page.getByText('6 of 10 assigned')).toBeVisible();
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByText(/add up to 6, but the line is for 10/)).toBeVisible();
  });

  test('a day the company or kitchen is closed cannot be used', async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await startOrder(page, 'Priya Raman', nextSaturday());
    await expect(page.getByText("Acme Analytics isn't open that day")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  });

  test('after the cut-off an admin can still place, and it is confirmed at once', async ({
    page,
    request,
  }) => {
    await apiSignIn(request, 'admin@test.com');
    const order = await createOrder(request, { deliveryDate: lockedDate() });
    expect(order.status).toBe('CONFIRMED');

    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${order.id}`);
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('(passed)')).toBeVisible();
  });

  test('drafts cannot be saved after the cut-off', async ({ request }) => {
    await apiSignIn(request, 'admin@test.com');
    const res = await request.post('/api/orders', {
      data: {
        employeeId: 1,
        deliveryDate: lockedDate(),
        lines: [{ dishId: 3, quantity: 1, combos: [{ quantity: 1, optionIds: [5] }] }],
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/only be placed/);
  });

  test('employee permissions are enforced on the server', async ({ request }) => {
    await apiSignIn(request, 'admin@test.com');
    // Rahul Nair (employee 4) may not change the delivery time.
    const res = await request.post('/api/orders', {
      data: {
        employeeId: 4,
        deliveryDate: openDate(),
        deliveryTime: '14:00',
        lines: [{ dishId: 3, quantity: 1, combos: [{ quantity: 1, optionIds: [5] }] }],
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/can't change the delivery time/);
  });
});

test.describe('changing orders', () => {
  test.skip(isLive, LOCAL_ONLY);

  test('a draft can be placed, then cancelled', async ({ page, request }) => {
    await apiSignIn(request, 'admin@test.com');
    const order = await createOrder(request, { place: false });
    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${order.id}`);

    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByText('Order placed')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel order' }).click();
    await page.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  });

  test('an admin rejects an order with a reason', async ({ page, request }) => {
    await apiSignIn(request, 'admin@test.com');
    const order = await createOrder(request);
    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${order.id}`);
    await page.getByRole('button', { name: 'Reject' }).click();
    await page.getByLabel('Reason').fill('Out of paneer');
    await page.getByRole('button', { name: 'Reject order' }).click();
    await expect(page.getByText('Rejected: Out of paneer').first()).toBeVisible();
  });

  test('an admin changes the delivery time of a confirmed order', async ({ page, request }) => {
    await apiSignIn(request, 'admin@test.com');
    const order = await createOrder(request, { deliveryDate: lockedDate() });
    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${order.id}`);
    await page.getByRole('button', { name: 'Change delivery' }).click();
    await page.getByLabel('Delivery time').fill('13:45');
    await page.getByRole('button', { name: 'Save delivery details' }).click();
    await expect(page.getByText(/, 1:45 pm$/)).toBeVisible();
    // The plan follows: leaves the kitchen 60 min before, cooked 30 min before that.
    await expect(page.getByText('12:15 pm')).toBeVisible();
  });

  test('two people cancelling at once: one wins, the other is told', async ({ request }) => {
    await apiSignIn(request, 'admin@test.com');
    const order = await createOrder(request, { place: false });
    const results = await Promise.all(
      [1, 2, 3].map(() => request.post(`/api/orders/${order.id}/cancel`)),
    );
    const codes = results.map((r) => r.status()).sort();
    expect(codes).toEqual([200, 409, 409]);
  });

  test('running the cut-off for a date that has not reached it is refused', async ({ request }) => {
    await apiSignIn(request, 'admin@test.com');
    const res = await request.post('/api/orders/cutoff/run', { data: { date: openDate() } });
    expect(res.status()).toBe(400);
  });
});

test.describe('order list', () => {
  test('search and filters find orders; kitchen can look but not create', async ({
    page,
    request,
  }) => {
    test.skip(isLive, LOCAL_ONLY);
    await apiSignIn(request, 'admin@test.com');
    const order = await createOrder(request);
    await signIn(page, 'admin@test.com');
    await page.goto('/orders');
    await page.getByLabel('Search').fill(`#${order.id}`);
    await expect(page.getByRole('cell', { name: `#${order.id}`, exact: true })).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(2); // header + the one order
  });

  test('kitchen sees orders but cannot create them', async ({ page, request }) => {
    await signIn(page, 'kitchen@test.com');
    await page.getByRole('link', { name: 'Orders' }).click();
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New order' })).toHaveCount(0);

    await apiSignIn(request, 'kitchen@test.com');
    const res = await request.post('/api/orders', { data: {} });
    expect(res.status()).toBe(403);
  });

  test('drivers cannot see the order list', async ({ request }) => {
    await apiSignIn(request, 'driver@test.com');
    expect((await request.get('/api/orders')).status()).toBe(403);
  });
});
