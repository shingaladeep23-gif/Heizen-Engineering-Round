import { expect, test } from '@playwright/test';
import { apiSignIn, signIn } from './helpers';

test('the admin dashboard shows today, money and the last week', async ({ page }) => {
  await signIn(page, 'admin@test.com');
  await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible();
  await expect(page.getByText('Orders today')).toBeVisible();
  await expect(page.getByText('Not invoiced yet')).toBeVisible();
  await expect(page.getByText(/^Last 7 days/)).toBeVisible();
  // The Startup tier is missing prices in the seed data, so it's flagged.
  await expect(page.getByText(/can.t be ordered on Startup/)).toBeVisible();
});

test('the kitchen dashboard has a prep list and stations', async ({ page }) => {
  await signIn(page, 'kitchen@test.com');
  await expect(page.getByRole('heading', { name: 'Kitchen dashboard' })).toBeVisible();
  await expect(page.getByText('Prep list: still to cook today')).toBeVisible();
  await expect(page.getByText('By station')).toBeVisible();
});

test('the dispatch dashboard shows what leaves next and the drivers', async ({ page }) => {
  await signIn(page, 'dispatch@test.com');
  await expect(page.getByRole('heading', { name: 'Dispatch dashboard' })).toBeVisible();
  await expect(page.getByText('Leaving next')).toBeVisible();
  await expect(page.getByText('Drivers today')).toBeVisible();
});

test('only admins get the admin figures', async ({ request }) => {
  await apiSignIn(request, 'kitchen@test.com');
  expect((await request.get('/api/dashboard/admin')).status()).toBe(403);
});
