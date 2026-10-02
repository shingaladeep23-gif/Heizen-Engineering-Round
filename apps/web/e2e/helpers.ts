import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PASSWORD = 'Test@1234';

// Tests that change data only run locally, never against the live site.
export const isLive = !!process.env.BASE_URL;
export const LOCAL_ONLY = 'changes data, so local only';

export async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export async function apiSignIn(request: APIRequestContext, email: string) {
  const res = await request.post('/api/auth/login', { data: { email, password: PASSWORD } });
  expect(res.ok()).toBe(true);
}
