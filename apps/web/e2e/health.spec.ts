import { expect, test } from '@playwright/test';

test('the API is reachable through the web app', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ ok: true });
});

test('the home page shows the API is up', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('API: up')).toBeVisible();
});
