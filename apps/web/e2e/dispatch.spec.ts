import { expect, test } from '@playwright/test';
import { todayOutForDelivery } from './db';
import { apiSignIn, createOrder, isLive, LOCAL_ONLY, lockedDate, signIn } from './helpers';

// A random delivery time, so each test almost always gets a drop of its own.
const pad = (n: number) => String(n).padStart(2, '0');
const uniqueTime = () =>
  `${pad(Math.floor(Math.random() * 24))}:${pad(Math.floor(Math.random() * 60))}`;
test.describe('dispatch board', () => {
  test.skip(isLive, LOCAL_ONLY);

  test('orders for the same place and time travel as one drop, step by step', async ({
    page,
    request,
  }) => {
    const time = uniqueTime();
    await apiSignIn(request, 'admin@test.com');
    // Priya Raman may change the time; both orders are for Acme HQ at the same time.
    const a = await createOrder(request, { deliveryDate: lockedDate(), deliveryTime: time });
    const b = await createOrder(request, { deliveryDate: lockedDate(), deliveryTime: time });

    await signIn(page, 'dispatch@test.com');
    await page.goto('/dispatch');
    await page.getByLabel('Delivery date').fill(lockedDate());
    const drop = page.locator(`[data-drop="Acme Analytics ${time}"]`);
    await expect(drop).toContainText(`#${a.id}`);
    await expect(drop).toContainText(`#${b.id}`);
    await expect(drop.getByText('In the kitchen')).toBeVisible();
    // The company's default driver is already assigned.
    await expect(drop.getByRole('combobox', { name: /Driver for/ })).toHaveValue('Dev Driver');
    // Nothing to do until it's cooked.
    await expect(drop.getByRole('button', { name: 'Mark ready to go' })).toHaveCount(0);

    for (const id of [a.id, b.id]) await request.post(`/api/kitchen/orders/${id}/complete`);
    await page.reload();
    await page.getByLabel('Delivery date').fill(lockedDate());

    await drop.getByRole('button', { name: 'Mark ready to go' }).click();
    await expect(drop.getByText('Ready to go', { exact: true })).toBeVisible();
    await drop.getByRole('button', { name: 'Send out for delivery' }).click();
    await expect(drop.getByText('Out for delivery', { exact: true })).toBeVisible();
    await drop.getByRole('button', { name: 'Mark delivered' }).click();
    await expect(drop.getByText('Delivered', { exact: true })).toBeVisible();

    await page.goto(`/orders/${a.id}`);
    await expect(page.getByText('Delivered', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Out for delivery')).toBeVisible();
  });

  test('steps cannot be skipped or repeated', async ({ request }) => {
    const time = uniqueTime();
    await apiSignIn(request, 'admin@test.com');
    const order = await createOrder(request, { deliveryDate: lockedDate(), deliveryTime: time });
    const drop = { companyId: 1, addressId: 1, date: lockedDate(), time };

    await apiSignIn(request, 'dispatch@test.com');
    let res = await request.post('/api/dispatch/step', { data: { drop, step: 'dispatch-ready' } });
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toMatch(/aren't cooked yet/);

    await apiSignIn(request, 'admin@test.com');
    await request.post(`/api/kitchen/orders/${order.id}/complete`);
    await apiSignIn(request, 'dispatch@test.com');
    res = await request.post('/api/dispatch/step', { data: { drop, step: 'out' } });
    expect((await res.json()).message).toMatch(/aren't ready for dispatch/);

    const twice = await Promise.all(
      [1, 2].map(() =>
        request.post('/api/dispatch/step', { data: { drop, step: 'dispatch-ready' } }),
      ),
    );
    expect(twice.map((r) => r.status()).sort()).toEqual([200, 409]);
  });

  test('drivers and the kitchen cannot use the dispatch board', async ({ request }) => {
    await apiSignIn(request, 'driver@test.com');
    expect((await request.get('/api/dispatch/drops')).status()).toBe(403);
    await apiSignIn(request, 'kitchen@test.com');
    expect((await request.post('/api/dispatch/step', { data: {} })).status()).toBe(403);
  });
});

test.describe('driver', () => {
  test.skip(isLive, LOCAL_ONLY);

  test("lands on today's deliveries and marks one delivered with a note, on a phone", async ({
    page,
  }) => {
    const drop = await todayOutForDelivery('driver@test.com');
    await page.setViewportSize({ width: 390, height: 844 }); // a typical phone
    await signIn(page, 'driver@test.com');
    await expect(page.getByRole('heading', { name: "Today's deliveries" })).toBeVisible();

    const card = page.locator(`[data-drop="Acme Analytics ${drop.time}"]`);
    await card.getByRole('button', { name: 'Mark delivered' }).click();
    await page.getByLabel('Note (optional)').fill('Left with reception');
    await page.getByRole('button', { name: 'Confirm delivered' }).click();
    await expect(card.getByText('Delivered', { exact: true })).toBeVisible();
    await expect(card.getByText('On time')).toBeVisible();
    await expect(card.getByText('Left with reception')).toBeVisible();

    // Usable on a phone: nothing wider than the screen.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });

  test("a driver can't mark someone else's drop delivered", async ({ request }) => {
    const drop = await todayOutForDelivery(null); // nobody's drop
    await apiSignIn(request, 'driver@test.com');
    const res = await request.post('/api/deliveries/delivered', {
      data: {
        drop: {
          companyId: drop.companyId,
          addressId: drop.addressId,
          date: drop.date,
          time: drop.time,
        },
      },
    });
    expect(res.status()).toBe(403);
  });
});
