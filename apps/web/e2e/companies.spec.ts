import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiSignIn, isLive, LOCAL_ONLY, signIn } from './helpers';

const ACME = 1;

async function acme(request: APIRequestContext) {
  return (await request.get(`/api/companies/${ACME}`)).json();
}

test.describe('companies and employees', () => {
  test.skip(isLive, LOCAL_ONLY);

  test('an admin creates a company, then adds an employee on its domain', async ({ page }) => {
    const domain = `test${Date.now()}.in`;
    await signIn(page, 'admin@test.com');
    await page.goto('/companies/new');
    const domains = page.getByRole('combobox', { name: 'Email domains' });
    await page.getByLabel('Company name').fill('Test Foods');
    await domains.fill('gmail.com');
    await domains.press('Enter');
    await page.getByLabel('Label').fill('Main office');
    await page.getByLabel('Full address').fill('1 MG Road, Bengaluru 560001');
    await page.getByLabel('Billing name').fill('Test Foods Pvt Ltd');
    await page.getByLabel('Billing email').fill(`accounts@${domain}`);
    await page.getByRole('button', { name: 'Save company' }).click();
    await expect(page.getByText('Public email domains are not allowed').first()).toBeVisible();

    // Swap gmail.com for a real company domain (Backspace removes the last tag).
    await domains.click();
    await domains.press('Backspace');
    await domains.fill(domain);
    await domains.press('Enter');
    await page.getByRole('button', { name: 'Save company' }).click();
    await expect(page.getByText('Company saved')).toBeVisible();
    await expect(page).toHaveURL(/\/companies\/\d+$/);

    await page.getByRole('button', { name: 'Add employee' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Ravi Kumar');
    await page.getByLabel('Work email').fill('ravi@gmail.com');
    await page.getByRole('button', { name: 'Save employee' }).click();
    await expect(page.getByText(`Must be an address at @${domain}`).first()).toBeVisible();
    await page.getByLabel('Work email').fill(`ravi@${domain}`);
    await page.getByRole('button', { name: 'Save employee' }).click();
    await expect(page.getByRole('cell', { name: `ravi@${domain}` })).toBeVisible();
  });

  test('two companies cannot share a domain', async ({ request }) => {
    await apiSignIn(request, 'admin@test.com');
    const company = await acme(request);
    const res = await request.post('/api/companies', {
      data: { ...company, name: 'Copycat', ownerId: null, addresses: [{ label: 'X', text: 'Y' }] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/already belongs to Acme Analytics/);
  });

  test('an address with orders cannot be removed, and a domain in use cannot be dropped', async ({
    request,
  }) => {
    await apiSignIn(request, 'admin@test.com');
    const company = await acme(request);
    // HQ (the first address) has orders from the order tests and seed data.
    let res = await request.put(`/api/companies/${ACME}`, {
      data: { ...company, addresses: company.addresses.slice(1), defaultAddressIndex: 0 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/has orders/);

    res = await request.put(`/api/companies/${ACME}`, {
      data: { ...company, domains: ['acme-new.in'] },
    });
    expect((await res.json()).message).toMatch(/still use @acmeanalytics.in/);
  });

  test("moving an employee needs an email on the new company's domain", async ({ request }) => {
    await apiSignIn(request, 'admin@test.com');
    const company = await acme(request);
    const employee = company.employees.find((e: { name: string }) => e.name === 'Rahul Nair');
    const res = await request.put(`/api/employees/${employee.id}`, {
      data: { ...employee, companyId: 2 }, // Bluepeak, but still an @acmeanalytics.in email
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/@bluepeak.io/);
  });
});

test.describe('settings', () => {
  test.skip(isLive, LOCAL_ONLY);

  test('a kitchen holiday blocks deliveries that day', async ({ request }) => {
    await apiSignIn(request, 'admin@test.com');
    const settings = await (await request.get('/api/settings')).json();
    const holiday = '2027-01-26'; // a Tuesday no other test uses
    const save = (holidays: unknown[]) =>
      request.put('/api/settings', { data: { ...settings, holidays } });

    expect((await save([...settings.holidays, { date: holiday, name: 'Republic Day' }])).ok()).toBe(
      true,
    );
    const info = await (
      await request.get(`/api/orders/delivery-info?employeeId=1&date=${holiday}`)
    ).json();
    expect(info.problems).toContain("The kitchen isn't cooking that day");

    expect((await save(settings.holidays)).ok()).toBe(true);
  });

  test('the settings page loads and saves', async ({ page }) => {
    await signIn(page, 'admin@test.com');
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByLabel('Cut-off time')).toHaveValue(/\d\d:\d\d/);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved')).toBeVisible();
  });
});

test('only admins change companies and settings', async ({ request }) => {
  await apiSignIn(request, 'dispatch@test.com');
  expect((await request.get(`/api/companies/${ACME}`)).status()).toBe(200); // can look
  expect((await request.put(`/api/companies/${ACME}`, { data: {} })).status()).toBe(403);
  expect((await request.get('/api/settings')).status()).toBe(403);
});
