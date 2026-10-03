// Every screen, driven the way staff use it: through the browser, as each
// role, with good and bad input. Where the other files check the rules
// through the API, this one checks that a person can actually reach each
// rule from the screen, and that every mistake comes back as a message they
// can act on, next to the right field where there is one.
//
// It builds its own company, tier, dish and staff (names end in this run's
// id), so it never disturbs the other tests running alongside it.
import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { todayOutForDelivery } from './db';
import { isLive, lockedDate, nextSaturday, openDate, PASSWORD, signIn } from './helpers';

// Everything is named the way qa-cleanup.ts recognises test data, so on the
// live site it's all removed again when the run ends.
const RUN = Date.now().toString(36);
const COMPANY = `Fernleaf QA Screens ${RUN}`;
const DOMAIN = `screens-${RUN}.fernleaf-qa.in`;
const TIER = `QA Ui Tier ${RUN}`;
const DISH = `QA Ui Thali ${RUN}`;
const CATEGORY = `QA Ui Specials ${RUN}`;
const DRIVER = `QA Ui Driver ${RUN}`;
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
// A date whose cut-off has passed: the next weekday locally (the local kitchen
// works Monday to Friday), tomorrow on the live site (it cooks every day).
const locked = () =>
  isLive
    ? new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10)
    : lockedDate();
// Earlier runs leave employees with the same names behind, so match the email too.
const ONE = new RegExp(`^Ui One [(]one@${DOMAIN}`);
const TWO = new RegExp(`^Ui Two [(]two@${DOMAIN}`);
const yesterday = () => new Date(Date.now() + 330 * 60_000 - 86_400_000).toISOString().slice(0, 10);

let admin: APIRequestContext;
const s = { companyId: 0, tierId: 0, dishId: 0, one: 0, two: 0 } as Record<string, number>;

// Mantine selects: open by their label, then click the option.
async function pick(page: Page, label: string, option: string | RegExp) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page
    .getByRole('option', { name: typeof option === 'string' ? new RegExp(`^${option}`) : option })
    .first()
    .click();
}
// Mantine multi-selects: click the visible box (as a person would), choose, close.
async function choose(field: Locator, page: Page, options: (string | RegExp)[]) {
  await field.locator('xpath=ancestor::div[contains(@class, "mantine-Input-input")][1]').click();
  for (const option of options) await page.getByRole('option', { name: option }).click();
  await page.keyboard.press('Escape');
}
const toast = (page: Page, text: string | RegExp) =>
  expect(page.locator('.mantine-Notification-root', { hasText: text }).first()).toBeVisible();
const fieldError = (page: Page, text: string | RegExp) =>
  expect(page.locator('.mantine-InputWrapper-error', { hasText: text }).first()).toBeVisible();

async function json<T>(path: string) {
  const res = await admin.get(path);
  expect(res.ok(), path).toBe(true);
  return (await res.json()) as T;
}

/** Places a thali order through the API, choosing each combination's base by name. */
async function placeThali(
  employeeId: number,
  deliveryDate: string,
  combos: { quantity: number; base: string }[],
) {
  const menu = await json<{
    categories: {
      dishes: { id: number; groups: { options: { id: number; name: string }[] }[] }[];
    }[];
  }>(`/api/menu/preview?employeeId=${employeeId}&allSecret=true`);
  const thali = menu.categories.flatMap((c) => c.dishes).find((d) => d.id === s.dishId)!;
  const id = (name: string) => thali.groups[0].options.find((o) => o.name === name)!.id;
  const res = await admin.post('/api/orders', {
    data: {
      employeeId,
      deliveryDate,
      place: true,
      lines: [
        {
          dishId: s.dishId,
          quantity: combos.reduce((sum, c) => sum + c.quantity, 0),
          combos: combos.map((c) => ({ quantity: c.quantity, optionIds: [id(c.base)] })),
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id: number; status: string };
}

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.describe('every screen, every role', () => {
  test.beforeAll(async () => {
    admin = await request.newContext({ baseURL: BASE });
    await admin.post('/api/auth/login', { data: { email: 'admin@test.com', password: PASSWORD } });
  });

  // ---------- Signing in (section 2) ----------

  test('sign-in: empty fields, a wrong password, an unknown email, then the right one', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await fieldError(page, 'Enter a valid email');
    await fieldError(page, 'Enter your password');

    await page.getByLabel('Email').fill('admin@test.com');
    await page.getByLabel('Password', { exact: true }).fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Wrong email or password')).toBeVisible();

    // Same words for an unknown email: no hint about which accounts exist.
    await page.getByLabel('Email').fill('nobody@test.com');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Wrong email or password')).toBeVisible();

    // Email case doesn't matter.
    await page.getByLabel('Email').fill('ADMIN@Test.com');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('each role sees only its own menu and lands on its own dashboard', async ({ page }) => {
    const roles: Record<string, { heading: string; nav: string[] }> = {
      'admin@test.com': {
        heading: 'Admin dashboard',
        nav: [
          'Dashboard',
          'Orders',
          'Kitchen board',
          'Dispatch',
          'Billing',
          'Companies',
          'Dishes',
          'Options',
          'Menu',
          'Menu preview',
          'Price tiers',
          'Reference lists',
          'Staff',
          'Settings',
        ],
      },
      'kitchen@test.com': {
        heading: 'Kitchen dashboard',
        nav: [
          'Dashboard',
          'Orders',
          'Kitchen board',
          'Dishes',
          'Options',
          'Menu',
          'Price tiers',
          'Reference lists',
        ],
      },
      'dispatch@test.com': {
        heading: 'Dispatch dashboard',
        nav: ['Dashboard', 'Orders', 'Dispatch', 'Companies', 'Menu preview'],
      },
      'driver@test.com': { heading: "Today's deliveries", nav: ['Dashboard'] },
    };
    for (const [email, role] of Object.entries(roles)) {
      await signIn(page, email);
      await expect(page.getByRole('heading', { name: role.heading })).toBeVisible();
      await expect(page.locator('nav a')).toHaveText(role.nav);
    }
  });

  test('pages a role may not use say so, show no data, and a signed-out visitor is sent to sign in', async ({
    page,
    browser,
  }) => {
    const blocked: [string, string[]][] = [
      ['kitchen@test.com', ['/billing', '/settings', '/staff', '/companies/1', '/orders/new']],
      ['dispatch@test.com', ['/billing', '/settings', '/staff', '/tiers', '/kitchen']],
      ['driver@test.com', ['/orders', '/kitchen', '/dispatch', '/billing', '/companies/1']],
    ];
    for (const [email, paths] of blocked) {
      await signIn(page, email);
      for (const path of paths) {
        await page.goto(path);
        await expect(
          page.getByText("You don't have access to this").first(),
          `${email} ${path}`,
        ).toBeVisible();
        await expect(page.locator('main')).not.toContainText('₹');
      }
    }

    // Signed out: straight to the sign-in page.
    const fresh = await browser.newPage();
    await fresh.goto('/orders');
    await expect(fresh).toHaveURL(/\/login/);
    await fresh.close();

    // Signing out ends the session for real.
    await signIn(page, 'admin@test.com');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/no-such-page');
    await expect(page.getByText('This page could not be found')).toBeVisible();
  });

  // ---------- Staff (section 3) ----------

  test('staff: bad input is refused next to the field; roles and access change from the table', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/staff');
    const add = page.getByRole('button', { name: 'Add staff member' });

    await add.click();
    await fieldError(page, 'Name is required');
    await page.getByLabel('Name', { exact: true }).fill(DRIVER);
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await add.click();
    await fieldError(page, 'Enter a valid email');
    await fieldError(page, 'At least 8 characters');

    await page.getByLabel('Email').fill('driver@test.com'); // taken
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await pick(page, 'Role', 'DRIVER');
    await add.click();
    await fieldError(page, 'Already in use');

    const email = `ui.driver.${RUN}@fernleaf-qa.in`;
    await page.getByLabel('Email').fill(email);
    await add.click();
    await toast(page, 'Staff member added');
    const row = page.getByRole('row', { name: new RegExp(email) });
    await expect(row).toBeVisible();

    // Change the role, then back; each change lands before the next.
    const role = row.getByRole('combobox', { name: `Role for ${email}` });
    for (const next of ['KITCHEN', 'DRIVER']) {
      await role.click();
      await page.getByRole('option', { name: next }).click();
      await expect(role).toHaveValue(next);
      await page.waitForLoadState('networkidle');
    }

    // Switch off: they can't sign in; switch back on: they can.
    const tryLogin = await request.newContext({ baseURL: BASE });
    const signInAs = () =>
      tryLogin.post('/api/auth/login', { data: { email, password: PASSWORD } });
    // The "updated" toast sits over this column for a few seconds; wait like a person would.
    const toastsGone = async () => {
      await page.mouse.move(0, 0); // a toast under the pointer stays open
      await expect(page.locator('.mantine-Notification-root')).toHaveCount(0);
    };
    await toastsGone();
    await row.getByRole('switch', { name: `${email} can sign in` }).click();
    await expect(row).toContainText('Switched off');
    await page.waitForLoadState('networkidle');
    expect((await signInAs()).status()).toBe(401);
    await toastsGone();
    await row.getByRole('switch', { name: `${email} can sign in` }).click();
    await expect(row).toContainText('Active');
    await page.waitForLoadState('networkidle');
    expect((await signInAs()).ok()).toBe(true);

    // You can't change your own role or switch yourself off.
    const me = page.getByRole('row', { name: /admin@test\.com/ });
    await expect(me.getByRole('combobox', { name: 'Role for admin@test.com' })).toBeDisabled();
    await expect(me.getByRole('switch')).toBeDisabled();
  });

  // ---------- Reference lists, options, dishes (4.1) ----------

  test('reference lists: add, refuse duplicates and blanks, refuse removing what is in use', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/lists');
    const name = `QA Ui Sesame ${RUN}`;
    const input = page.getByLabel('New Allergens');
    const card = page.locator('.mantine-Card-root', { hasText: 'Allergens' }).first();

    await input.fill(name);
    await card.getByRole('button', { name: 'Add' }).click();
    await expect(card.getByText(name)).toBeVisible();
    await input.fill(name);
    await card.getByRole('button', { name: 'Add' }).click();
    await toast(page, 'already taken');
    await input.fill('   ');
    await card.getByRole('button', { name: 'Add' }).click();
    await toast(page, 'Required');

    await card.getByRole('button', { name: `Remove ${name}` }).click();
    await expect(card.getByText(name)).toHaveCount(0);
    await card.getByRole('button', { name: 'Remove Dairy' }).click(); // on many dishes
    await toast(page, /Still used in \d+ place/);
    await expect(card.getByText('Dairy', { exact: true })).toBeVisible();

    // Kitchen can read the lists but has no controls.
    await signIn(page, 'kitchen@test.com');
    await page.goto('/lists');
    await expect(page.getByText('Kitchen stations')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  });

  test('options: a blank name is refused, a new option is saved, edited and switched off', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/options');
    await page.getByRole('button', { name: 'New option' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Save option' }).click();
    await fieldError(page, 'Required');

    const name = `QA Ui Pickle ${RUN}`;
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Cost price').fill('7.5');
    await choose(dialog.getByRole('combobox', { name: 'Allergens' }), page, ['Mustard']);
    await dialog.getByRole('button', { name: 'Save option' }).click();
    await toast(page, 'Option saved');
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toContainText('₹7.50');
    await expect(row).toContainText('Mustard');
    await expect(row).toContainText('Active');

    // The same name again is refused.
    await page.getByRole('button', { name: 'New option' }).click();
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('button', { name: 'Save option' }).click();
    await toast(page, 'already taken');
    await page.keyboard.press('Escape');

    // Edit: switch it off.
    await row.click();
    await dialog.getByLabel('Active').click({ force: true });
    await dialog.getByRole('button', { name: 'Save option' }).click();
    await expect(row).toContainText('Inactive');
  });

  test('dishes: every field checked, option groups ordered, a duplicate SKU refused', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/dishes');
    await page.getByRole('link', { name: 'New dish' }).click();
    await expect(page).toHaveURL(/\/dishes\/new$/);
    await page.getByRole('button', { name: 'Save' }).click();
    await fieldError(page, 'Required'); // name and SKU

    await page.getByLabel('Name', { exact: true }).fill(DISH);
    await page.getByLabel('SKU').fill(`QA-UI-${RUN}`);
    await page.getByLabel('Image link').fill('not a link');
    await page.getByRole('button', { name: 'Save' }).click();
    await fieldError(page, 'Must be a full link');
    await page.getByLabel('Image link').fill('');

    await page.getByLabel('Description').fill('A test thali');
    await page.getByLabel('Cost price').fill('30');
    await page.getByLabel('Minimum order qty').fill('2');
    await page.getByText('Cold', { exact: true }).click();
    await choose(page.getByRole('combobox', { name: 'Allergens' }), page, ['Dairy']);

    // A group with no name and no options is refused, field by field.
    await page.getByRole('button', { name: 'Add group' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await fieldError(page, 'Pick at least one option');

    await page.getByLabel('Group name').fill('Ui base');
    const options = page.getByRole('combobox', { name: "Options, in the order they're shown" });
    await choose(options, page, ['Jeera rice', 'Brown rice']);
    await page.getByLabel('Max choices').fill('3');
    await page.getByRole('button', { name: 'Save' }).click();
    await fieldError(page, "Can't allow more choices than there are options");
    await page.getByLabel('Max choices').fill('1');

    // A second, optional group, moved above the first, then back.
    await page.getByRole('button', { name: 'Add group' }).click();
    await page.getByLabel('Group name').nth(1).fill('Ui extra');
    await page.getByRole('checkbox', { name: 'Required' }).nth(1).uncheck();
    await choose(options.nth(1), page, ['Raita']);
    await page.getByRole('button', { name: 'Move up' }).nth(1).click();
    await expect(page.getByLabel('Group name').first()).toHaveValue('Ui extra');
    await page.getByRole('button', { name: 'Move down' }).first().click();
    await expect(page.getByLabel('Group name').first()).toHaveValue('Ui base');

    await page.getByRole('button', { name: 'Save' }).click();
    await toast(page, 'Dish saved');
    await expect(page).toHaveURL(/\/dishes\/\d+$/);
    s.dishId = Number(page.url().split('/').pop());

    // Saved exactly as entered, groups in order.
    await page.reload();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(DISH);
    await expect(page.getByLabel('Group name').first()).toHaveValue('Ui base');
    await expect(page.getByLabel('Group name').nth(1)).toHaveValue('Ui extra');
    await expect(page.getByLabel('Cost price')).toHaveValue('₹30');

    // Another dish with the same SKU is refused.
    await page.goto('/dishes/new');
    await page.getByLabel('Name', { exact: true }).fill(`QA Ui Copy ${RUN}`);
    await page.getByLabel('SKU').fill(`QA-UI-${RUN}`);
    await page.getByRole('button', { name: 'Save' }).click();
    await toast(page, 'already taken');

    // Kitchen: the same dish, read-only.
    await signIn(page, 'kitchen@test.com');
    await page.goto(`/dishes/${s.dishId}`);
    await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  });

  // ---------- Pricing (4.3) ----------

  test('tiers: a typed tier filled in from the grid, a derived tier showing its formula', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/tiers');
    await page.getByRole('button', { name: 'New tier' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Save tier' }).click();
    await fieldError(page, 'Required');
    await dialog.getByLabel('Name').fill(TIER);
    await pick(page, 'How prices are set', 'Cost × a factor');
    await dialog.getByRole('button', { name: 'Save tier' }).click();
    await fieldError(page, 'Enter a factor');
    await pick(page, 'How prices are set', 'Typed in by hand');
    await dialog.getByRole('button', { name: 'Save tier' }).click();
    await toast(page, 'Tier saved');

    const card = page.locator('.mantine-Card-root', { hasText: TIER });
    await expect(card).toContainText('Prices typed in');
    await expect(card).toContainText('dishes without a price');
    await card.click();
    await expect(page.getByRole('heading', { name: TIER })).toBeVisible();

    // Fill prices from the grid: type, then Enter or leave the field.
    const price = async (name: string, rupees: string) => {
      const input = page.getByLabel(`${name} price`, { exact: true });
      await input.fill(rupees);
      await input.press('Enter');
      await expect(page.getByRole('row', { name: new RegExp(`^${name}`) })).not.toContainText(
        'Missing',
      );
    };
    await price('Paneer Tikka Rice Bowl', '199.50');
    await price(DISH, '250');
    for (const [option, rupees] of [
      ['Jeera rice', '15'],
      ['Brown rice', '20'],
      ['Raita', '10'],
    ]) {
      await price(option, rupees);
    }
    await expect(page.getByRole('row', { name: /^Paneer Tikka Rice Bowl/ })).toContainText(
      '₹199.50',
    );
    // Zero isn't a price.
    const bowl = page.getByLabel('Paneer Tikka Rice Bowl price', { exact: true });
    await bowl.fill('0');
    await bowl.press('Enter');
    await toast(page, 'Must be above zero');
    await bowl.fill('199.50');
    await bowl.press('Enter');

    // Only the gaps.
    await page.getByLabel('Only show missing').click({ force: true });
    await expect(page.getByRole('row', { name: /^Paneer Tikka Rice Bowl/ })).toHaveCount(0);
    await expect(page.getByText('Missing: hidden from menus').first()).toBeVisible();
    await page.getByLabel('Only show missing').click({ force: true });

    const tiers = await json<{ id: number; name: string }[]>('/api/tiers');
    s.tierId = tiers.find((t) => t.name === TIER)!.id;

    // A derived tier: Cost × 2.4, prices shown as "(formula)", overridable.
    await page.getByRole('button', { name: 'New tier' }).click();
    await dialog.getByLabel('Name').fill(`QA Ui Cost ${RUN}`);
    await pick(page, 'How prices are set', 'Cost × a factor');
    await dialog.getByLabel('Factor').fill('2.4');
    await dialog.getByRole('button', { name: 'Save tier' }).click();
    const derived = page.locator('.mantine-Card-root', { hasText: `QA Ui Cost ${RUN}` });
    await expect(derived).toContainText('Cost × 2.4');
    await derived.click();
    // ₹30 cost × 2.4 = ₹72.
    await expect(page.getByRole('row', { name: new RegExp(`^${DISH}`) })).toContainText(
      '₹72.00 (formula)',
    );
    const override = page.getByLabel(`${DISH} price`, { exact: true });
    await override.fill('80');
    await override.press('Enter');
    await expect(page.getByRole('row', { name: new RegExp(`^${DISH}`) })).toContainText('₹80.00');
    await page.getByRole('button', { name: `Clear ${DISH} price` }).click();
    await expect(page.getByRole('row', { name: new RegExp(`^${DISH}`) })).toContainText(
      '₹72.00 (formula)',
    );

    // "Derived from" only offers tiers whose prices are typed in.
    await page.getByRole('button', { name: 'Edit rule' }).click();
    await pick(page, 'How prices are set', 'Another tier × a factor');
    await page.getByRole('combobox', { name: 'Derived from' }).click();
    await expect(page.getByRole('option', { name: TIER })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Enterprise' })).toHaveCount(0); // derived
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  // ---------- Menu (4.2) ----------

  test('menu: a new category, a dish added, secret, reordered, hidden and shown', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/menu');
    await page.getByRole('button', { name: 'Add category' }).click();
    await toast(page, 'Required');
    await page.getByLabel('New category name').fill(CATEGORY);
    await page.getByRole('button', { name: 'Add category' }).click();
    const card = page.locator('.mantine-Card-root', { hasText: CATEGORY });
    await expect(card).toBeVisible();

    await card.getByRole('combobox', { name: `Add a dish to ${CATEGORY}` }).fill(DISH);
    await page.getByRole('option', { name: DISH }).click();
    await card.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(card.getByRole('row', { name: new RegExp(DISH) })).toBeVisible();

    await card.getByLabel('Secret').click({ force: true });
    await expect(card.getByLabel('Secret')).toBeChecked();

    // Move it up one place: it swaps with the category above.
    const headings = page.locator('.mantine-Card-root h4');
    const before = await headings.allTextContents();
    const at = before.indexOf(CATEGORY);
    await card.getByRole('button', { name: 'Move up' }).first().click();
    await expect(headings.nth(at - 1)).toHaveText(CATEGORY);
    await page.reload();
    await expect(headings.nth(at - 1)).toHaveText(CATEGORY); // saved, not just on screen

    // Hide the dish in this category, then show it again.
    const shown = card.getByRole('row', { name: new RegExp(DISH) }).getByLabel('Shown');
    await shown.click({ force: true });
    await expect(shown).not.toBeChecked();
    await shown.click({ force: true });
    await expect(shown).toBeChecked();
  });

  // ---------- Companies and employees (4.4, 4.5) ----------

  test('companies: every rule on the form is checked, then a full company is saved', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/companies');
    await page.getByRole('link', { name: 'New company' }).click();
    const save = page.getByRole('button', { name: 'Save company' });
    await save.click();
    await fieldError(page, 'Add at least one email domain');
    await fieldError(page, 'Enter a valid email');

    await page.getByLabel('Company name').fill(COMPANY);
    const domains = page.getByRole('combobox', { name: 'Email domains' });
    for (const [domain, message] of [
      ['gmail.com', 'Public email domains are not allowed'],
      ['not a domain', 'Not a domain'],
    ]) {
      await domains.fill(domain);
      await domains.press('Enter');
      await save.click();
      await fieldError(page, message);
      await page.locator('.mantine-Pill-remove').first().click(); // remove the tag
    }
    await domains.fill('acmeanalytics.in'); // Acme's
    await domains.press('Enter');
    await page.getByLabel('Billing name').fill(`${COMPANY} Pvt Ltd`);
    await page.getByLabel('Billing email').fill(`accounts@${DOMAIN}`);
    await page.getByLabel('Label').fill('Tower A');
    await page.getByLabel('Full address').fill('1 Test Road, Bengaluru');
    await save.click();
    await fieldError(page, 'acmeanalytics.in already belongs to Acme Analytics');
    await page.locator('.mantine-Pill-remove').first().click();
    await domains.fill(DOMAIN);
    await domains.press('Enter');

    // A second address, made the default.
    await page.getByRole('button', { name: 'Add address' }).click();
    await page.getByLabel('Label').nth(1).fill('Tower B');
    await page.getByLabel('Full address').nth(1).fill('2 Test Road, Bengaluru');
    await page.getByRole('radio', { name: 'Default' }).nth(1).check();

    // Calendar: every day, and a holiday left without a date is refused on its row.
    for (const day of ['Sat', 'Sun']) await page.getByLabel(day).check();
    await page.getByRole('button', { name: 'Add holiday' }).click();
    await page.getByLabel('Holiday 1 name').fill('Founders day');
    await save.click();
    await fieldError(page, 'Pick a date');
    await page.getByLabel('Holiday 1 date').fill(nextSaturday());

    // Delivery defaults, tier.
    await page.getByLabel('Delivery time').fill('12:15');
    await page.getByLabel('Leaves the kitchen (min before)').fill('45');
    await pick(page, 'Packaging', 'Standard box');
    await pick(page, 'Default driver', 'Dev Driver');
    await page.getByLabel('Standing instructions for the driver').fill('Ring the bell twice');
    await pick(page, 'Price tier', TIER);
    await page.getByLabel('Leaves the kitchen (min before)').fill('9999');
    await save.click();
    await fieldError(page, 'At most 600 minutes');
    await page.getByLabel('Leaves the kitchen (min before)').fill('45');

    await save.click();
    await toast(page, 'Company saved');
    await expect(page).toHaveURL(/\/companies\/\d+$/);
    s.companyId = Number(page.url().split('/').pop());

    // Everything came back as saved.
    await page.reload();
    await expect(page.getByLabel('Company name')).toHaveValue(COMPANY);
    await expect(page.getByRole('radio', { name: 'Default' }).nth(1)).toBeChecked();
    await expect(page.getByLabel('Holiday 1 date')).toHaveValue(nextSaturday());
    await expect(page.getByLabel('Delivery time')).toHaveValue('12:15');
    await expect(page.getByRole('combobox', { name: 'Price tier' })).toHaveValue(TIER);
  });

  test('employees: domain and duplicates checked, flags, allergies, owner, moving company', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto(`/companies/${s.companyId}`);
    const dialog = page.getByRole('dialog');

    const addEmployee = async (name: string, email: string, all: boolean, dairy = false) => {
      await page.getByRole('button', { name: 'Add employee' }).click();
      await dialog.getByLabel('Name').fill(name);
      await dialog.getByLabel('Work email').fill(email);
      if (all) {
        for (const flag of [
          'Can choose their own delivery address',
          'Can change the delivery time',
          'Can change packaging',
        ]) {
          await dialog.getByLabel(flag).click({ force: true });
        }
      }
      if (dairy) {
        await choose(dialog.getByRole('combobox', { name: 'Allergies' }), page, ['Dairy']);
      }
      await dialog.getByRole('button', { name: 'Save employee' }).click();
    };

    await addEmployee('Ui One', `one@gmail.com`, false);
    await fieldError(page, `Must be an address at @${DOMAIN}`);
    await page.keyboard.press('Escape');
    // An unsaved change on the company form must survive adding an employee.
    const instructions = page.getByLabel('Standing instructions for the driver');
    await instructions.fill('Ring the bell twice (unsaved edit)');
    await addEmployee('Ui One', `one@${DOMAIN}`, false, true);
    await toast(page, 'Employee saved');
    await expect(page.getByRole('row', { name: /Ui One/ })).toBeVisible();
    await expect(instructions).toHaveValue('Ring the bell twice (unsaved edit)');
    await instructions.fill('Ring the bell twice');
    // Saving an employee mustn't also save (or re-submit) the company form.
    await expect(
      page.locator('.mantine-Notification-root', { hasText: 'Company saved' }),
    ).toHaveCount(0);
    await addEmployee('Ui Two', `two@${DOMAIN}`, true);
    await toast(page, 'Employee saved');
    await addEmployee('Ui Twin', `one@${DOMAIN}`, false);
    await toast(page, 'already taken');
    await page.keyboard.press('Escape');

    const rows = page.getByRole('row');
    await expect(rows.filter({ hasText: 'Ui Two' })).toContainText(
      'can change address, can change time, can change packaging',
    );

    // Owner: one of its own employees.
    await pick(page, 'Owner', 'Ui One');
    await page.getByRole('button', { name: 'Save company' }).click();
    await toast(page, 'Company saved');
    await expect(rows.filter({ hasText: 'Ui One' })).toContainText('Owner');

    const detail = await json<{ employees: { id: number; name: string }[] }>(
      `/api/companies/${s.companyId}`,
    );
    s.one = detail.employees.find((e) => e.name === 'Ui One')!.id;
    s.two = detail.employees.find((e) => e.name === 'Ui Two')!.id;

    // The owner can't be moved out; anyone else can, with an email on the new domain.
    await rows.filter({ hasText: 'Ui One' }).click();
    await pick(page, 'Company', 'Acme Analytics');
    await dialog.getByLabel('Work email').fill(`ui.one.${RUN}@acmeanalytics.in`);
    await dialog.getByRole('button', { name: 'Save employee' }).click();
    await toast(page, 'owns');
    await page.keyboard.press('Escape');

    // Dispatch can look at a company but not change it.
    await signIn(page, 'dispatch@test.com');
    await page.goto(`/companies/${s.companyId}`);
    await expect(page.getByLabel('Company name')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save company' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add employee' })).toHaveCount(0);
  });

  test('menu preview: the company tier, secret categories and allergy warnings', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/preview');
    await page.getByRole('combobox', { name: 'Employee' }).fill('Ui One');
    await page.getByRole('option', { name: new RegExp(`Ui One.*${DOMAIN}`) }).click();
    await expect(page.getByText(`priced on the ${TIER} tier`)).toBeVisible();

    const bowl = page.locator('.mantine-Card-root', { hasText: 'Paneer Tikka Rice Bowl' });
    await expect(bowl).toContainText('₹199.50');
    await expect(bowl).toContainText('Contains Dairy'); // the bowl, and Ui One's allergy
    await expect(bowl).toContainText('Raita +₹10.00 ⚠ Contains Dairy'); // and the option
    // Dishes with no price on this tier aren't there at all.
    await expect(page.getByText('Dal Makhani Thali')).toHaveCount(0);
    // The secret category isn't listed until it's opened.
    await expect(page.getByText(DISH)).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Open a secret category' }).click();
    await page.getByRole('option', { name: CATEGORY }).click();
    await expect(page.locator('.mantine-Card-root', { hasText: DISH })).toContainText('₹250.00');
  });

  // ---------- Orders (4.6) ----------

  test('new order: closed and past dates block it; the employee’s locked fields stay locked', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/orders/new');
    await pick(page, 'Employee', ONE);
    const date = page.getByLabel('Delivery date');
    const place = page.getByRole('button', { name: 'Place order' });

    await date.fill(yesterday());
    await expect(page.getByText('That date has already passed')).toBeVisible();
    await expect(place).toBeDisabled();
    await date.fill(nextSaturday()); // the company's own holiday, set up above
    await expect(page.getByText(`${COMPANY} isn't open that day`)).toBeVisible();
    await expect(place).toBeDisabled();

    await date.fill(openDate());
    await expect(page.getByText(/^Cut-off: /)).toBeVisible();
    await expect(place).toBeEnabled();
    // Ui One may change nothing: the company defaults, locked.
    await expect(page.getByLabel('Delivery time')).toHaveValue('12:15');
    await expect(page.getByLabel('Delivery time')).toBeDisabled();
    await expect(page.getByRole('combobox', { name: 'Address' })).toHaveValue('Tower B');
    await expect(page.getByRole('combobox', { name: 'Address' })).toBeDisabled();
    await expect(
      page.getByText('Company default; this employee can’t change it').first(),
    ).toBeVisible();
    // The menu is Ui One's: tier prices, nothing unpriced.
    await expect(page.getByText(`(${TIER} prices)`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Dal Makhani Thali' })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /Paneer Tikka Rice Bowl/ })).toContainText(
      '⚠ Contains Dairy',
    );
  });

  test('new order: every combination mistake is refused with a message, then a draft is saved', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/orders/new');
    await pick(page, 'Employee', ONE);
    await page.getByLabel('Delivery date').fill(openDate());
    await page.getByRole('button', { name: 'Add Paneer Tikka Rice Bowl' }).click();
    const place = page.getByRole('button', { name: 'Place order' });

    // A required choice left empty.
    await place.click();
    await toast(page, 'Paneer Tikka Rice Bowl: "Choose your rice" needs a choice');

    await page.getByLabel('Paneer Tikka Rice Bowl quantity').fill('3');
    await page.getByLabel('Paneer Tikka Rice Bowl combination 1 quantity').fill('3');
    await pick(page, 'Paneer Tikka Rice Bowl combination 1 Choose your rice', 'Jeera rice');
    // Combinations that don't add up to the line.
    await page.getByRole('button', { name: 'Add combination' }).click();
    await expect(page.getByText('3 + 1 of 3 assigned')).toBeVisible();
    await place.click();
    await toast(page, 'the combinations add up to 4, but the line is for 3');
    // The same choices twice.
    await page.getByLabel('Paneer Tikka Rice Bowl combination 1 quantity').fill('2');
    await pick(page, 'Paneer Tikka Rice Bowl combination 2 Choose your rice', 'Jeera rice');
    await place.click();
    await toast(page, 'two combinations have the same choices');
    await pick(page, 'Paneer Tikka Rice Bowl combination 2 Choose your rice', 'Brown rice');
    // An optional add-on, flagged for Ui One's dairy allergy.
    // Only Raita is priced on this tier, so the add-on group allows one
    // choice (a single select). Picking it proves its label carries the warning.
    await pick(page, 'Paneer Tikka Rice Bowl combination 2 Add-ons', /Raita.*⚠ Contains Dairy/);
    await expect(page.getByText('2 + 1 of 3 assigned')).toBeVisible();

    // The minimum order quantity (2) on the thali.
    await page.getByRole('button', { name: `Add ${DISH}` }).click();
    await page.getByLabel(`${DISH} quantity`).fill('1');
    await page.getByLabel(`${DISH} combination 1 quantity`).fill('1');
    await pick(page, `${DISH} combination 1 Ui base`, 'Jeera rice');
    await place.click();
    await toast(page, `${DISH} has a minimum order of 2`);
    await page.getByRole('button', { name: `Remove ${DISH}` }).click();

    // 2 × (199.50 + 15) + 1 × (199.50 + 20 + 10) = 429.00 + 229.50
    await expect(page.getByRole('heading', { name: 'Total ₹658.50' })).toBeVisible();
    await page.getByRole('button', { name: 'Save as draft' }).click();
    await toast(page, 'Order saved');
    await expect(page).toHaveURL(/\/orders\/\d+$/);
    s.draft = Number(page.url().split('/').pop());
    await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('row', { name: /Order total/ })).toContainText('₹658.50');
    await expect(page.getByText('Raita (+₹10.00)')).toBeVisible();
  });

  test('a draft is edited, placed and cancelled from its page; the timeline follows', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${s.draft}`);
    await page.getByRole('link', { name: 'Edit' }).click();
    await page.getByLabel('Paneer Tikka Rice Bowl quantity').fill('4');
    await page.getByLabel('Paneer Tikka Rice Bowl combination 1 quantity').fill('3');
    await page.getByRole('button', { name: 'Save as draft' }).click();
    await toast(page, 'Order saved');
    // 3 × 214.50 + 229.50
    await expect(page.getByRole('row', { name: /Order total/ })).toContainText('₹873.00');

    await page.getByRole('button', { name: 'Place order' }).click();
    await toast(page, 'Order placed');
    await expect(page.getByText('Placed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Created', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel order' }).click();
    await expect(page.getByRole('dialog')).toContainText('The company won’t be billed for it.');
    await page.getByRole('button', { name: 'Yes, cancel it' }).click();
    await toast(page, 'Order cancelled');
    await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  });

  test('an employee who may change things: time, address and packaging; after the cut-off it confirms', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/orders/new');
    await pick(page, 'Employee', TWO);
    await page.getByLabel('Delivery date').fill(locked());
    await expect(page.getByText(/The cut-off was .* confirmed straight away/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save as draft' })).toHaveCount(0);

    await page.getByLabel('Delivery time').fill('13:40');
    await pick(page, 'Address', 'Tower A');
    await pick(page, 'Packaging', 'Eco bagasse box');
    await page.getByRole('button', { name: `Add ${DISH}` }).click();
    await pick(page, `${DISH} combination 1 Ui base`, 'Brown rice');
    await expect(page.getByRole('heading', { name: 'Total ₹540.00' })).toBeVisible(); // 2 × 270
    await page.getByRole('button', { name: 'Place order' }).click();
    await toast(page, 'Order saved');
    await expect(page).toHaveURL(/\/orders\/\d+$/);
    s.confirmed = Number(page.url().split('/').pop());
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
    await expect(page.locator('main')).toContainText('13:40');
    await expect(page.locator('main')).toContainText('Tower A, 1 Test Road');
    await expect(page.locator('main')).toContainText('Eco bagasse box');
    await expect(page.locator('main')).toContainText('Dev Driver');
    await expect(page.locator('main')).toContainText('Ring the bell twice');
    // 45 minutes to leave, 30 to cook: leaves by 12:55, cooked by 12:25.
    await expect(page.locator('main')).toContainText('12:55 pm');
    await expect(page.locator('main')).toContainText('12:25 pm');
    // Confirmed lines can't be edited, even by an admin.
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  });

  test('admin overrides on a confirmed order: delivery details, no credit before delivery, reject needs a reason', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${s.confirmed}`);

    await page.getByRole('button', { name: 'Change delivery' }).click();
    await page.getByRole('dialog').getByLabel('Delivery time').fill('14:00');
    await page.getByRole('button', { name: 'Save delivery details' }).click();
    await toast(page, 'Delivery details changed');
    // 14:00 less 45 minutes to leave, less 30 to cook.
    await expect(page.locator('main')).toContainText('1:15 pm');
    await expect(page.locator('main')).toContainText('12:45 pm');

    // Not delivered yet, so nothing can be short: no credit.
    await expect(page.getByRole('button', { name: 'Credit short delivery' })).toHaveCount(0);

    // Reject: the box starts empty each time, and a reason is required.
    const reject = page.getByRole('button', { name: 'Reject', exact: true });
    await reject.click();
    await page.getByRole('dialog').getByLabel('Reason').fill('changed my mind');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await reject.click();
    await expect(page.getByRole('dialog').getByLabel('Reason')).toHaveValue('');
    await page.getByRole('button', { name: 'Reject order' }).click();
    await toast(page, 'Say why');
    await page.keyboard.press('Escape');
  });

  test('editing an order whose dish has left the menu: the line is shown, removed, and it saves', async ({
    page,
  }) => {
    // A placed order for Ui One, then the thali loses its price on the tier.
    const placed = await placeThali(s.one, openDate(), [{ quantity: 2, base: 'Jeera rice' }]);
    await admin.put(`/api/tiers/${s.tierId}/prices`, {
      data: { kind: 'dish', id: s.dishId, price: null },
    });
    try {
      await signIn(page, 'admin@test.com');
      await page.goto(`/orders/${placed.id}/edit`);
      const notice = page.getByText("No longer on this employee's menu");
      await expect(notice).toBeVisible();
      await expect(page.locator('main')).toContainText(`2 × ${DISH} can't be ordered any more`);
      await page.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(notice).toHaveCount(0);
      await page.getByRole('button', { name: 'Add Paneer Tikka Rice Bowl' }).click();
      await pick(page, 'Paneer Tikka Rice Bowl combination 1 Choose your rice', 'Jeera rice');
      await page.getByRole('button', { name: 'Place order' }).click();
      await toast(page, 'Order saved');
      await expect(page.getByRole('row', { name: /Order total/ })).toContainText('₹214.50');
    } finally {
      await admin.put(`/api/tiers/${s.tierId}/prices`, {
        data: { kind: 'dish', id: s.dishId, price: 25000 },
      });
    }
  });

  test('order list: search, every filter, nothing found, and the cut-off runner', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/orders');
    const search = page.getByLabel('Search');
    const rows = page.locator('tbody tr');

    await search.fill(`#${s.confirmed}`);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(COMPANY);
    await search.fill('Ui Two');
    await expect(rows.first()).toContainText('Ui Two');
    await search.fill('');

    await pick(page, 'Company', COMPANY);
    await expect(rows.first()).toContainText(COMPANY);
    for (const row of await rows.all()) await expect(row).toContainText(COMPANY);
    await pick(page, 'Status', 'Cancelled');
    await expect(rows).toHaveCount(1); // the cancelled draft
    await pick(page, 'Status', 'Confirmed');
    await expect(rows.first()).toContainText(`#${s.confirmed}`);
    await pick(page, 'Invoiced', 'Invoiced');
    await expect(page.getByText('No orders match these filters.')).toBeVisible();

    // The cut-off runner: refused for a date still open, fine for a past one, twice.
    await page.getByRole('button', { name: 'Run cut-off' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Delivery date').fill(openDate());
    await dialog.getByRole('button', { name: 'Run cut-off' }).click();
    await toast(page, "The cut-off for that date hasn't passed yet");
    await dialog.getByLabel('Delivery date').fill(yesterday());
    await dialog.getByRole('button', { name: 'Run cut-off' }).click();
    await expect(dialog.getByText(/confirmed, \d+ drafts cancelled/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Run cut-off' }).click();
    await expect(dialog.getByText('0 confirmed, 0 drafts cancelled')).toBeVisible();

    // Kitchen can look but not create or run the cut-off; drivers can't open it at all.
    await signIn(page, 'kitchen@test.com');
    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New order' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Run cut-off' })).toHaveCount(0);
  });

  // ---------- Kitchen, dispatch and the driver (4.7, 4.8) ----------

  test('kitchen board: start, done, station filter, placed orders waiting, counts', async ({
    page,
  }) => {
    // A confirmed order for Ui One (default time and address): two prep units.
    const kitchenOrder = await placeThali(s.one, locked(), [
      { quantity: 2, base: 'Jeera rice' },
      { quantity: 1, base: 'Brown rice' },
    ]);
    s.kitchen = kitchenOrder.id;

    await signIn(page, 'kitchen@test.com');
    await page.goto('/kitchen');
    await page.getByLabel('Delivery date').fill(locked());
    await page.locator('.mantine-SegmentedControl-root').getByText('Unassigned').click();
    const units = page.locator('tbody tr').filter({ hasText: `#${s.kitchen}` });
    await expect(units).toHaveCount(2);
    for (const row of await page.locator('tbody tr').all()) {
      await expect(row).not.toContainText('Paneer Tikka'); // Tandoor, filtered out
    }

    const jeeraRow = units.filter({ hasText: 'Jeera rice' });
    await jeeraRow.getByRole('button', { name: 'Start' }).click();
    await expect(jeeraRow).toContainText('Cooking');
    await expect(jeeraRow.getByRole('button', { name: 'Start' })).toHaveCount(0);
    await jeeraRow.getByRole('button', { name: 'Done' }).click();
    await expect(jeeraRow).toContainText('Done');
    await expect(jeeraRow.getByRole('button')).toHaveCount(0);
    // Done without Start is fine too.
    const brownRow = units.filter({ hasText: 'Brown rice' });
    await brownRow.getByRole('button', { name: 'Done' }).click();
    await expect(brownRow).toContainText('Done');

    // A placed (not yet confirmed) order is shown greyed out, with nothing to press.
    await page.getByLabel('Delivery date').fill(openDate());
    await page.locator('.mantine-SegmentedControl-root').getByText('All').click();
    const waiting = page.locator('tbody tr').filter({ hasText: 'Not confirmed yet' }).first();
    await expect(waiting).toBeVisible();
    await expect(waiting.getByRole('button')).toHaveCount(0);

    // The order is now kitchen-ready.
    await signIn(page, 'admin@test.com');
    await page.goto(`/orders/${s.kitchen}`);
    await expect(page.getByText('Kitchen ready', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark all cooked' })).toHaveCount(0);
    // And an admin can cook a whole order at once.
    await page.goto(`/orders/${s.confirmed}`);
    await page.getByRole('button', { name: 'Mark all cooked' }).click();
    await toast(page, 'Every unit marked cooked');
    await expect(page.getByText('Kitchen ready', { exact: true })).toBeVisible();
  });

  test('dispatch board: one drop per company, address and time; a driver; each step in turn', async ({
    page,
  }) => {
    await signIn(page, 'dispatch@test.com');
    await page.goto('/dispatch');
    await page.getByLabel('Delivery date').fill(locked());

    // #confirmed is at Tower A 14:00 (overridden); #kitchen at Tower B 12:15.
    const drop = page.locator(`[data-drop="${COMPANY} 12:15"]`);
    await expect(drop).toContainText(`#${s.kitchen}`);
    await expect(drop).toContainText('Tower B');
    await expect(drop).toContainText('Ring the bell twice');
    await expect(drop.getByRole('combobox', { name: /Driver for/ })).toHaveValue('Dev Driver');

    await drop.getByRole('combobox', { name: /Driver for/ }).click();
    await page.getByRole('option', { name: DRIVER }).click();
    await toast(page, 'Driver assigned');
    await expect(drop.getByRole('combobox', { name: /Driver for/ })).toHaveValue(DRIVER);

    await drop.getByRole('button', { name: 'Mark ready to go' }).click();
    await expect(drop.getByText('Ready to go', { exact: true })).toBeVisible();
    await drop.getByRole('button', { name: 'Send out for delivery' }).click();
    await expect(drop.getByText('Out for delivery', { exact: true })).toBeVisible();
    await expect(drop.getByRole('combobox', { name: /Driver for/ })).toBeDisabled();
    await drop.getByRole('button', { name: 'Mark delivered' }).click();
    await expect(drop.getByText('Delivered', { exact: true })).toBeVisible();
    await expect(drop.getByRole('button')).toHaveCount(0);

    // The other drop (cooked by the admin above) is ready for its first step.
    const other = page.locator(`[data-drop="${COMPANY} 14:00"]`);
    await expect(other.getByRole('button', { name: 'Mark ready to go' })).toBeVisible();
  });

  test('driver on a phone: only their drops, delivered with a note and a photo, on time', async ({
    page,
  }) => {
    // On this run's own company, so no other test's drop can share its time.
    const mine = await todayOutForDelivery('driver@test.com', s.one);
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'driver@test.com');
    await expect(page.getByRole('heading', { name: "Today's deliveries" })).toBeVisible();
    await expect(page.getByText(/\d+ of \d+ still to deliver/)).toBeVisible();
    const drop = page.locator(`[data-drop="${COMPANY} ${mine.time}"]`);
    await expect(drop).toContainText('Out for delivery');
    // No links into screens a driver can't open.
    await expect(drop.getByRole('link', { name: `#${mine.orderId}` })).toHaveCount(0);
    await drop.getByRole('button', { name: 'Mark delivered' }).click();
    await page.getByLabel('Note (optional)').fill('Ui: left with security');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'proof.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await page.getByRole('button', { name: 'Confirm delivered' }).click();
    await toast(page, 'Marked delivered');
    await expect(drop.getByText('Delivered', { exact: true })).toBeVisible();
    await expect(drop.getByText('On time')).toBeVisible();
    await expect(drop).toContainText('Ui: left with security');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
  });

  // ---------- Billing (4.9) ----------

  test('billing: a short delivery credited, pick what to invoice, totals add up, mark paid, cancelling credits', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    // The order dispatch delivered above: a credit for a short delivery,
    // never more than the order cost.
    await page.goto(`/orders/${s.kitchen}`);
    await page.getByRole('button', { name: 'Credit short delivery' }).click();
    await page.getByLabel('Amount to credit').fill('9999');
    await page.getByLabel('Reason').fill('Ui: two boxes short');
    await page.getByRole('button', { name: 'Record credit' }).click();
    await toast(page, /At most ₹[\d,]+\.\d\d can still be credited/);
    await page.getByLabel('Amount to credit').fill('25');
    await page.getByRole('button', { name: 'Record credit' }).click();
    await toast(page, 'Credit recorded');
    await expect(page.getByRole('row', { name: /Ui: two boxes short/ })).toContainText('-₹25.00');

    await page.goto('/billing');
    await page.getByRole('cell', { name: COMPANY }).click();
    await expect(page.getByText(`Bill to ${COMPANY} Pvt Ltd, accounts@${DOMAIN}`)).toBeVisible();

    // Billable: the confirmed and delivered orders only, plus the ₹25 credit.
    const unbilled = await json<{
      unbilledOrders: { id: number; total: number; status: string }[];
      unbilledCredits: { amount: number }[];
    }>(`/api/billing/companies/${s.companyId}`);
    expect(
      unbilled.unbilledOrders.every((o) => ['CONFIRMED', 'DELIVERED'].includes(o.status)),
    ).toBe(true);
    expect(unbilled.unbilledOrders.map((o) => o.id)).not.toContain(s.draft); // cancelled
    const all =
      unbilled.unbilledOrders.reduce((sum, o) => sum + o.total, 0) +
      unbilled.unbilledCredits.reduce((sum, c) => sum + c.amount, 0);
    const rupees = (paise: number) =>
      new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
    await expect(page.getByText(`Invoice total ${rupees(all)}`)).toBeVisible();

    // Leave one order out: the total drops by exactly its amount.
    const left = unbilled.unbilledOrders.find((o) => o.id === s.confirmed)!;
    await page.getByRole('checkbox', { name: `Include order #${s.confirmed}` }).uncheck();
    await expect(page.getByText(`Invoice total ${rupees(all - left.total)}`)).toBeVisible();
    await page.getByRole('button', { name: 'Create invoice' }).click();
    await toast(page, 'Invoice created');
    await expect(page).toHaveURL(/\/invoices\/\d+$/);
    const invoiceId = Number(page.url().split('/').pop());
    await expect(page.getByRole('heading', { name: `Invoice #${invoiceId}` })).toBeVisible();
    await expect(page.locator('main')).toContainText(`${COMPANY} Pvt Ltd`);
    await expect(page.locator('main')).toContainText(rupees(all - left.total));
    await expect(page.locator('main')).toContainText('Unpaid');

    // The order left out is still waiting; invoice it on its own, then mark paid.
    await page.goto(`/billing/${s.companyId}`);
    await expect(page.getByRole('link', { name: `#${s.confirmed}` })).toBeVisible();
    await page.getByRole('button', { name: 'Create invoice' }).click();
    await toast(page, 'Invoice created');
    await page.goto(`/billing/${s.companyId}`);
    await expect(page.getByText('Everything is invoiced.')).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(`Invoice #${invoiceId}\\b`) });
    await row.getByRole('button', { name: 'Mark paid' }).click();
    await toast(page, 'Marked paid');
    await expect(row.getByText('Paid', { exact: true })).toBeVisible();

    // Cancelling an invoiced order: the invoice stays, a credit waits for the next one.
    await page.goto(`/orders/${s.confirmed}`);
    await expect(page.getByText(/^Invoice #\d+$/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel order' }).click();
    await expect(page.getByRole('dialog')).toContainText('a credit for the full amount');
    await page.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(page.getByRole('row', { name: /Cancelled after invoicing/ })).toContainText(
      '-₹540.00',
    );
    await page.goto(`/billing/${s.companyId}`);
    await expect(page.getByText('Credit: Cancelled after invoicing')).toBeVisible();
    await expect(page.getByText('Invoice total -₹540.00')).toBeVisible();
    await page.getByRole('button', { name: 'Create invoice' }).click();
    await expect(page.getByText('Credit on #' + s.confirmed).first()).toBeVisible();

    // The order list's invoiced filter agrees.
    await page.goto('/orders');
    await pick(page, 'Company', COMPANY);
    await pick(page, 'Invoiced', 'Invoiced');
    await expect(page.locator('tbody tr').first()).toContainText('Yes');
  });

  // ---------- Settings (4.10) ----------

  test('settings: bad values are refused on the field; nothing changes until they are fixed', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await page.goto('/settings');
    const before = await json<Record<string, unknown>>('/api/settings');
    const save = page.getByRole('button', { name: 'Save settings' });

    await page.getByLabel('Working days before delivery').fill('99');
    await save.click();
    await fieldError(page, 'At most 14 working days');
    await page.getByLabel('Working days before delivery').fill(String(before.cutoffDays));

    await page.getByLabel('On-time grace (min)').fill('500');
    await save.click();
    await fieldError(page, 'At most 240 minutes');
    await page.getByLabel('On-time grace (min)').fill(String(before.onTimeGraceMinutes));

    // A holiday with no date is pointed out on its own row.
    await page.getByRole('button', { name: 'Add holiday' }).click();
    const n = ((before.holidays as unknown[]) ?? []).length + 1;
    await page.getByLabel(`Holiday ${n} name`).fill('Ui holiday');
    await save.click();
    await fieldError(page, 'Pick a date');
    await page.getByRole('button', { name: `Remove holiday ${n}` }).click();

    // No working days at all is refused.
    const days = before.kitchenWorkingDays as number[];
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (const d of days) await page.getByLabel(names[d - 1]).uncheck();
    await save.click();
    await fieldError(page, 'Pick at least one day');
    for (const d of days) await page.getByLabel(names[d - 1]).check();

    expect(await json('/api/settings')).toEqual(before); // nothing saved so far
    await save.click();
    await toast(page, 'Settings saved');
    expect(await json('/api/settings')).toEqual(before); // saved as it was
  });

  // ---------- Dashboards (4.11) ----------

  test('dashboards: each role’s figures render, and the admin sees what needs a decision', async ({
    page,
  }) => {
    await signIn(page, 'admin@test.com');
    await expect(page.getByText('Needs a decision')).toBeVisible();
    await expect(page.getByText(new RegExp(`have no price on ${TIER}`))).toBeVisible();
    for (const label of ['Orders today', 'Not invoiced yet', 'Unpaid invoices', 'Last 7 days']) {
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
    }
    await expect(page.locator('main')).not.toContainText(/NaN|undefined|Invalid Date/);

    await signIn(page, 'kitchen@test.com');
    for (const label of ['Portions today', 'Portions still to cook', 'Late units', 'At risk']) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
    await expect(page.locator('main')).not.toContainText(/NaN|undefined|Invalid Date/);

    await signIn(page, 'dispatch@test.com');
    for (const label of ['Drops today', 'Out on the road', 'Delivered', 'Running late']) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
    await expect(page.locator('main')).not.toContainText(/NaN|undefined|Invalid Date/);
  });

  // ---------- Phones ----------

  test('on a phone, no screen is wider than the phone (wide tables scroll inside themselves)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'admin@test.com');
    for (const path of [
      '/dashboard',
      '/orders',
      `/orders/${s.confirmed}`,
      '/orders/new',
      '/kitchen',
      '/dispatch',
      '/billing',
      `/billing/${s.companyId}`,
      '/companies',
      `/companies/${s.companyId}`,
      '/dishes',
      `/dishes/${s.dishId}`,
      '/options',
      '/menu',
      '/preview',
      '/tiers',
      '/lists',
      '/staff',
      '/settings',
    ]) {
      await page.goto(path);
      await expect(page.locator('main')).not.toBeEmpty();
      await page.waitForLoadState('networkidle');
      const wider = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(wider, path).toBeLessThanOrEqual(1);
    }
  });
});
