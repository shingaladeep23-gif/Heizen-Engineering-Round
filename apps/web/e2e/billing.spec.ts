import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiSignIn, createOrder, isLive, LOCAL_ONLY, lockedDate, signIn } from './helpers';

// Billing tests use Nimbus Labs (employee 20, Nikhil Reddy), which no other
// test orders for, so "invoice everything unbilled" can't pick up another
// test's orders.
const NIMBUS = 4;
const confirmedNimbusOrder = (request: APIRequestContext) =>
  createOrder(request, { employeeId: 20, deliveryDate: lockedDate() });

type Invoice = {
  id: number;
  total: number;
  orders: { total: number }[];
  credits: { amount: number }[];
};

test.describe('billing', () => {
  test.skip(isLive, LOCAL_ONLY);

  test('invoice a company, then mark the invoice paid', async ({ page, request }) => {
    await apiSignIn(request, 'admin@test.com');
    const order = await confirmedNimbusOrder(request);

    await signIn(page, 'admin@test.com');
    await page.getByRole('link', { name: 'Billing' }).click();
    await page.getByRole('cell', { name: 'Nimbus Labs' }).click();
    await expect(page.getByRole('link', { name: `#${order.id}` })).toBeVisible();
    await page.getByRole('button', { name: 'Create invoice' }).click();

    await expect(page).toHaveURL(/\/invoices\/\d+$/);
    await expect(page.getByRole('link', { name: `#${order.id}` })).toBeVisible();
    await expect(page.getByText('Unpaid')).toBeVisible();

    await page.goto(`/billing/${NIMBUS}`);
    await expect(page.getByText('Everything is invoiced.')).toBeVisible();
    await page.getByRole('button', { name: 'Mark paid' }).first().click();
    await expect(page.getByText('Marked paid')).toBeVisible();

    await page.goto(`/orders/${order.id}`);
    await expect(page.getByText(/^Invoice #\d+$/)).toBeVisible();
  });

  test('an order can be on one invoice only, even if two people try at once', async ({
    request,
  }) => {
    await apiSignIn(request, 'admin@test.com');
    const order = await confirmedNimbusOrder(request);
    const body = { companyId: NIMBUS, orderIds: [order.id] };
    const results = await Promise.all(
      [1, 2].map(() => request.post('/api/billing/invoices', { data: body })),
    );
    expect(results.map((r) => r.status()).sort()).toEqual([201, 409]);

    const again = await request.post('/api/billing/invoices', { data: body });
    expect(again.status()).toBe(409);
  });

  test('cancelling an invoiced order credits it on the next invoice, and totals add up', async ({
    request,
  }) => {
    await apiSignIn(request, 'admin@test.com');
    const order = await confirmedNimbusOrder(request);
    const first = await (
      await request.post('/api/billing/invoices', {
        data: { companyId: NIMBUS, orderIds: [order.id] },
      })
    ).json();

    // The invoice never changes...
    expect((await request.post(`/api/orders/${order.id}/cancel`)).ok()).toBe(true);
    const unchanged: Invoice = await (
      await request.get(`/api/billing/invoices/${first.id}`)
    ).json();
    expect(unchanged.total).toBe(first.total);

    // ...instead a credit for the full amount waits for the next one.
    const billing = await (await request.get(`/api/billing/companies/${NIMBUS}`)).json();
    const credit = billing.unbilledCredits.find((c: { orderId: number }) => c.orderId === order.id);
    expect(credit.amount).toBe(-unchanged.orders[0].total);

    const next = await (
      await request.post('/api/billing/invoices', {
        data: { companyId: NIMBUS, adjustmentIds: [credit.id] },
      })
    ).json();
    const detail: Invoice = await (await request.get(`/api/billing/invoices/${next.id}`)).json();
    const sum =
      detail.orders.reduce((s, o) => s + o.total, 0) +
      detail.credits.reduce((s, c) => s + c.amount, 0);
    expect(detail.total).toBe(sum);
  });

  test('a short delivery is credited, but never for more than the order cost', async ({
    page,
    request,
  }) => {
    await apiSignIn(request, 'admin@test.com');
    const order = await confirmedNimbusOrder(request);
    const over = await request.post(`/api/billing/orders/${order.id}/credit`, {
      data: { amount: 99_999_999, reason: 'Way too much' },
    });
    expect(over.status()).toBe(400);

    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${order.id}`);
    await page.getByRole('button', { name: 'Credit short delivery' }).click();
    await page.getByLabel('Amount to credit').fill('50');
    await page.getByLabel('Reason').fill('One bowl missing');
    await page.getByRole('button', { name: 'Record credit' }).click();
    await expect(page.getByText('Adjustment: One bowl missing')).toBeVisible();
    await expect(page.getByRole('row', { name: /One bowl missing/ })).toContainText('-₹50.00');
  });
});

test('only admins can see billing', async ({ request }) => {
  for (const email of ['kitchen@test.com', 'dispatch@test.com', 'driver@test.com']) {
    await apiSignIn(request, email);
    expect((await request.get('/api/billing/companies')).status()).toBe(403);
  }
});
