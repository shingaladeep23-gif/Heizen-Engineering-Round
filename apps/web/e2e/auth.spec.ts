import { expect, test } from '@playwright/test';
import { apiSignIn, signIn } from './helpers';

const ACCOUNTS = [
  { email: 'admin@test.com', dashboard: 'Admin dashboard' },
  { email: 'kitchen@test.com', dashboard: 'Kitchen dashboard' },
  { email: 'dispatch@test.com', dashboard: 'Dispatch dashboard' },
  { email: 'driver@test.com', dashboard: "Today's deliveries" },
];

for (const account of ACCOUNTS) {
  test(`${account.email} signs in and lands on their dashboard`, async ({ page }) => {
    await signIn(page, account.email);
    await expect(page.getByRole('heading', { name: account.dashboard })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });
}

test('if signing out fails, the user is told instead of nothing happening', async ({ page }) => {
  await signIn(page, 'admin@test.com');
  await page.route('**/api/auth/logout', (route) => route.abort());
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText(/Couldn't sign out/)).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard/);
});

test('a wrong password is rejected with a clear message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@test.com');
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Wrong email or password')).toBeVisible();
});

test('signed-out visitors are sent to the login page', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('the API refuses requests without a session', async ({ request }) => {
  expect((await request.get('/api/auth/me')).status()).toBe(401);
});

// Permissions are enforced by the server, not by hiding buttons.
for (const email of ['kitchen@test.com', 'dispatch@test.com', 'driver@test.com']) {
  test(`${email} cannot use the staff API`, async ({ request }) => {
    await apiSignIn(request, email);
    expect((await request.get('/api/staff')).status()).toBe(403);
    const create = await request.post('/api/staff', {
      data: {
        name: 'Sneaky',
        email: 'sneaky@test.com',
        password: 'whatever1',
        role: 'ADMIN',
      },
    });
    expect(create.status()).toBe(403);
  });
}

test('only admins see the Staff link', async ({ page }) => {
  await signIn(page, 'kitchen@test.com');
  await expect(page.getByRole('link', { name: 'Staff' })).toHaveCount(0);
});

test('an admin can add a staff member, who can then sign in', async ({ page, browser }) => {
  test.skip(!!process.env.BASE_URL, 'creates accounts, so local only');
  const email = `cook-${Date.now()}@test.com`;
  await signIn(page, 'admin@test.com');
  await page.getByRole('link', { name: 'Staff' }).click();

  await page.getByLabel('Name').fill('New Cook');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Test@1234');
  await page.getByRole('button', { name: 'Add staff member' }).click();
  await expect(page.getByRole('cell', { name: email })).toBeVisible();

  // Same email again is refused, and the form says why.
  await page.getByLabel('Name').fill('Copy');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Test@1234');
  await page.getByRole('button', { name: 'Add staff member' }).click();
  await expect(page.getByText('Already in use', { exact: true })).toBeVisible();

  const otherPage = await (await browser.newContext()).newPage();
  await signIn(otherPage, email);
  await expect(otherPage.getByRole('heading', { name: 'Kitchen dashboard' })).toBeVisible();
});
