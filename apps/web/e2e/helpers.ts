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

// ---- Dates, in IST like the app ----

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) =>
  new Date(Date.parse(day) + n * 86_400_000).toISOString().slice(0, 10);
const isWeekday = (day: string) => ![0, 6].includes(new Date(day).getUTCDay());

const firstWeekdayFrom = (day: string) => {
  while (!isWeekday(day)) day = addDays(day, 1);
  return day;
};

// With the default 2-working-day cut-off, a weekday a week out is still open...
export const openDate = () => firstWeekdayFrom(addDays(todayIST(), 7));
// ...and the next weekday after today has always passed its cut-off.
export const lockedDate = () => firstWeekdayFrom(addDays(todayIST(), 1));
export const nextSaturday = () => {
  let day = addDays(todayIST(), 1);
  while (new Date(day).getUTCDay() !== 6) day = addDays(day, 1);
  return day;
};

// Seed ids: employee 1 = Priya Raman (Acme, may change everything),
// dish 3 = Rajma Chawal Bowl, option 5 = Jeera rice.
export async function createOrder(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {},
) {
  const res = await request.post('/api/orders', {
    data: {
      employeeId: 1,
      deliveryDate: openDate(),
      lines: [{ dishId: 3, quantity: 2, combos: [{ quantity: 2, optionIds: [5] }] }],
      place: true,
      ...overrides,
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id: number; status: string };
}
