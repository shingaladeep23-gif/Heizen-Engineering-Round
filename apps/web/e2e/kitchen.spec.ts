import { expect, test } from '@playwright/test';
import {
  apiSignIn,
  createOrder,
  isLive,
  LOCAL_ONLY,
  lockedDate,
  openDate,
  signIn,
} from './helpers';

// Seed ids: dish 1 = Paneer Tikka Rice Bowl (rice: 5 jeera, 6 brown),
// dish 12 = Gulab Jamun (no station, so "Unassigned").
const TWO_UNITS = [
  {
    dishId: 1,
    quantity: 3,
    combos: [
      { quantity: 2, optionIds: [6] },
      { quantity: 1, optionIds: [5] },
    ],
  },
];

test.describe('kitchen board', () => {
  test.skip(isLive, LOCAL_ONLY);

  test('cooks start and finish units; the order is ready only when all are done', async ({
    page,
    request,
  }) => {
    await apiSignIn(request, 'admin@test.com');
    const order = await createOrder(request, { deliveryDate: lockedDate(), lines: TWO_UNITS });

    await signIn(page, 'kitchen@test.com');
    await page.goto('/kitchen');
    await page.getByLabel('Delivery date').fill(lockedDate());
    const rows = page.getByRole('row').filter({ hasText: `#${order.id}` });
    await expect(rows).toHaveCount(2);
    const brown = rows.filter({ hasText: 'Brown rice' });
    const jeera = rows.filter({ hasText: 'Jeera rice' });

    await brown.getByRole('button', { name: 'Start' }).click();
    await expect(brown.getByText('Cooking')).toBeVisible();
    await expect(brown.getByRole('button', { name: 'Start' })).toHaveCount(0);

    // Finishing a unit nobody started is allowed (it records a start too).
    await jeera.getByRole('button', { name: 'Done' }).click();
    await expect(jeera.getByText('Done', { exact: true })).toBeVisible();

    await page.goto(`/orders/${order.id}`);
    await expect(page.getByText('Kitchen started')).toBeVisible();
    await expect(page.getByText('Kitchen ready', { exact: true })).toHaveCount(0);

    await page.goto('/kitchen');
    await page.getByLabel('Delivery date').fill(lockedDate());
    await brown.getByRole('button', { name: 'Done' }).click();
    await expect(brown.getByText('Done', { exact: true })).toBeVisible();
    await page.goto(`/orders/${order.id}`);
    await expect(page.getByText('Kitchen ready', { exact: true })).toBeVisible();
  });

  test('a unit cannot be finished twice, even by two people at once', async ({ request }) => {
    await apiSignIn(request, 'admin@test.com');
    const order = await createOrder(request, { deliveryDate: lockedDate() });
    await apiSignIn(request, 'kitchen@test.com');
    const board = await (await request.get(`/api/kitchen?date=${lockedDate()}`)).json();
    const unit = board.units.find((u: { orderId: number }) => u.orderId === order.id);

    const results = await Promise.all(
      [1, 2, 3].map(() => request.post(`/api/kitchen/units/${unit.id}/done`)),
    );
    expect(results.map((r) => r.status()).sort()).toEqual([200, 409, 409]);
    const again = await request.post(`/api/kitchen/units/${unit.id}/start`);
    expect(again.status()).toBe(409);
  });

  test('orders that are only placed show up but cannot be worked on', async ({ page, request }) => {
    await apiSignIn(request, 'admin@test.com');
    const order = await createOrder(request, { deliveryDate: openDate() });
    expect(order.status).toBe('PLACED');

    await signIn(page, 'kitchen@test.com');
    await page.goto('/kitchen');
    await page.getByLabel('Delivery date').fill(openDate());
    const row = page.getByRole('row').filter({ hasText: `#${order.id}` });
    await expect(row.getByText('Not confirmed yet')).toBeVisible();
    await expect(row.getByRole('button')).toHaveCount(0);

    const board = await (await request.get(`/api/kitchen?date=${openDate()}`)).json();
    const unit = board.units.find((u: { orderId: number }) => u.orderId === order.id);
    expect((await request.post(`/api/kitchen/units/${unit.id}/start`)).status()).toBe(409);
  });

  test('dishes without a station land under Unassigned', async ({ page, request }) => {
    await apiSignIn(request, 'admin@test.com');
    const order = await createOrder(request, {
      deliveryDate: lockedDate(),
      lines: [{ dishId: 12, quantity: 2, combos: [{ quantity: 2, optionIds: [] }] }],
    });
    await signIn(page, 'kitchen@test.com');
    await page.goto('/kitchen');
    await page.getByLabel('Delivery date').fill(lockedDate());
    await page.getByText('Unassigned', { exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: `#${order.id}` })).toContainText(
      'Gulab Jamun',
    );
  });

  test('an admin can mark a whole order cooked', async ({ page, request }) => {
    await apiSignIn(request, 'admin@test.com');
    const order = await createOrder(request, { deliveryDate: lockedDate(), lines: TWO_UNITS });
    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${order.id}`);
    await page.getByRole('button', { name: 'Mark all cooked' }).click();
    await expect(page.getByText('Kitchen ready', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark all cooked' })).toHaveCount(0);
  });
});

test('only the kitchen (and admins) can work the board', async ({ request }) => {
  await apiSignIn(request, 'dispatch@test.com');
  expect((await request.post('/api/kitchen/units/1/done')).status()).toBe(403);
  await apiSignIn(request, 'driver@test.com');
  expect((await request.get('/api/kitchen')).status()).toBe(403);
});

test('the kitchen board loads for today', async ({ page }) => {
  await signIn(page, 'kitchen@test.com');
  await page.getByRole('link', { name: 'Kitchen board' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
  await expect(page.getByText('Portions left')).toBeVisible();
});
