import { expect, test } from '@playwright/test';

test('the API is reachable through the web app', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ ok: true });
});
