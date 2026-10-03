import { expect, test, type Page } from '@playwright/test';
import { apiSignIn, isLive, LOCAL_ONLY, signIn } from './helpers';

test.describe('catalogue', () => {
  test('an admin creates a dish with an option group', async ({ page }) => {
    test.skip(isLive, LOCAL_ONLY);
    const sku = `TEST-${Date.now()}`;
    await signIn(page, 'admin@test.com');
    await page.goto('/dishes/new');

    // Saving an empty form shows what's missing next to each field.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Required').first()).toBeVisible();

    await page.getByLabel('Name', { exact: true }).fill('Test Thali');
    await page.getByLabel('SKU').fill(sku);
    await page.getByLabel('Cost price').fill('80');
    await page.getByRole('button', { name: 'Add group' }).click();
    await page.getByLabel('Group name').fill('Choose your bread');
    await page.getByRole('combobox', { name: "Options, in the order they're shown" }).click();
    await page.getByRole('option', { name: 'Butter naan' }).click();
    await page.getByRole('option', { name: 'Tandoori roti' }).click();
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Dish saved')).toBeVisible();
    await expect(page).toHaveURL(/\/dishes\/\d+$/);
    await page.goto('/dishes');
    await expect(page.getByRole('cell', { name: sku })).toBeVisible();
  });

  test('reference lists refuse to delete something still in use', async ({ page }) => {
    test.skip(isLive, LOCAL_ONLY);
    await signIn(page, 'admin@test.com');
    await page.goto('/lists');
    await page.getByRole('button', { name: 'Remove Dairy' }).click();
    await expect(page.getByText(/Still used in \d+ place/)).toBeVisible();

    const name = `Test station ${Date.now()}`;
    await page.getByLabel('New Kitchen stations').fill(name);
    await page.getByLabel('New Kitchen stations').press('Enter');
    await expect(page.getByText(name)).toBeVisible();
    await page.getByRole('button', { name: `Remove ${name}` }).click();
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test('kitchen can look at dishes but not change them', async ({ page, request }) => {
    await signIn(page, 'kitchen@test.com');
    await page.getByRole('link', { name: 'Dishes' }).click();
    await expect(page.getByRole('cell', { name: 'Paneer Tikka Rice Bowl' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New dish' })).toHaveCount(0);

    await apiSignIn(request, 'kitchen@test.com');
    const res = await request.put('/api/tiers/1/prices', {
      data: { kind: 'dish', id: 1, price: 100 },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('pricing', () => {
  test('the tier grid shows gaps, and filling one removes it', async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/tiers');
    // Read the current count, since other tests may add dishes.
    const missing = page
      .locator('.mantine-Card-root', { hasText: 'Startup' })
      .getByText(/dishes without a price/);
    await expect(missing).toBeVisible();
    const before = Number((await missing.textContent())?.match(/\d+/)?.[0]);
    expect(before).toBeGreaterThanOrEqual(6);

    await page.getByText('Startup', { exact: true }).click();
    await page.getByLabel('Only show missing').check();
    await expect(page.getByText('Missing: hidden from menus').first()).toBeVisible();

    test.skip(isLive, LOCAL_ONLY);
    const price = page.getByLabel('Jain Veg Pulao price');
    await price.fill('150');
    await price.press('Enter');
    await expect(missing).toHaveText(`${before - 1} dishes without a price`);

    // Put it back.
    await page.getByLabel('Only show missing').uncheck();
    await page.getByRole('button', { name: 'Clear Jain Veg Pulao price' }).click();
    await expect(missing).toHaveText(`${before} dishes without a price`);
  });

  test('derived tiers explain their rule and show formula prices', async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/tiers');
    await expect(page.getByText('Standard − 10%')).toBeVisible();
    await expect(page.getByText('Cost × 2.6')).toBeVisible();
    await page.getByText('Partner', { exact: true }).click();
    // Paneer Tikka Rice Bowl costs ₹65, so cost × 2.6 = ₹169.
    const row = page.getByRole('row', { name: /Paneer Tikka Rice Bowl/ });
    await expect(row.getByText('₹169.00')).toBeVisible();
  });
});

test.describe('menu preview', () => {
  async function preview(page: Page, employee: string) {
    await page.goto('/preview');
    await page.getByRole('combobox', { name: 'Employee' }).fill(employee);
    await page.getByRole('option', { name: new RegExp(employee) }).click();
  }

  test('shows each company its own menu and prices', async ({ page }) => {
    await signIn(page, 'admin@test.com');

    // Nimbus Labs: Startup tier (no thalis priced) and Desserts hidden.
    await preview(page, 'Isha Kapoor');
    await expect(page.getByText('priced on the Startup tier')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bowls' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Desserts' })).toHaveCount(0);
    await expect(page.getByText('Dal Makhani Thali')).toHaveCount(0);

    // Kaveri Consulting: the chicken dishes are hidden for this company.
    await preview(page, 'Harish Gowda');
    await expect(page.getByText('Dal Makhani Thali')).toBeVisible();
    await expect(page.getByText('Chicken Curry Thali')).toHaveCount(0);
  });

  test('secret categories are not listed but can be opened', async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await preview(page, 'Arjun Mehta');
    await expect(page.getByText('Hyderabadi Dum Biryani')).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Open a secret category' }).click();
    await page.getByRole('option', { name: "Chef's Specials" }).click();
    await expect(page.getByText('Hyderabadi Dum Biryani')).toBeVisible();
  });

  test("warns about an employee's allergies", async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await preview(page, 'Arjun Mehta'); // allergic to peanuts
    const poha = page.locator('.mantine-Card-root', { hasText: 'Masala Poha' });
    await expect(poha.getByText('Contains Peanuts')).toBeVisible();
  });

  // Uses a dish no other test orders, since test files run in parallel.
  test('hiding a dish on the menu takes it off the preview', async ({ page }) => {
    test.skip(isLive, LOCAL_ONLY);
    // The switch only flips once the server confirms, so click and then wait.
    const shown = () =>
      page.getByRole('row', { name: /Overnight Oats with Fruit/ }).getByLabel('Shown');
    await signIn(page, 'admin@test.com');
    await page.goto('/menu');
    await expect(shown()).toBeVisible();
    if (!(await shown().isChecked())) {
      await shown().click();
      await expect(shown()).toBeChecked();
    }

    await shown().click();
    await expect(shown()).not.toBeChecked();
    await preview(page, 'Rohan Desai');
    await expect(page.getByText('Overnight Oats with Fruit')).toHaveCount(0);

    await page.goto('/menu');
    await shown().click();
    await expect(shown()).toBeChecked();
    await preview(page, 'Rohan Desai');
    await expect(page.getByText('Overnight Oats with Fruit')).toBeVisible();
  });
});
