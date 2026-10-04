import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiSignIn, createOrder, isLive, LOCAL_ONLY, signIn } from './helpers';

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
    // An order of its own, so the address has one even on a fresh database.
    const order = await createOrder(request);
    const { address } = await (await request.get(`/api/orders/${order.id}`)).json();
    const company = await acme(request);
    const others = company.addresses.filter((a: { id: number }) => a.id !== address.id);
    let res = await request.put(`/api/companies/${ACME}`, {
      data: { ...company, addresses: others, defaultAddressIndex: 0 },
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

  test('an employee with open orders is moved only once those are settled', async ({ request }) => {
    await apiSignIn(request, 'admin@test.com');
    const name = `mover${Date.now()}`;
    const created = await request.post('/api/employees', {
      data: { companyId: ACME, name: 'Mover', email: `${name}@acmeanalytics.in` },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const employee = await created.json();
    const order = await createOrder(request, { employeeId: employee.id });

    const move = { ...employee, companyId: 2, email: `${name}@bluepeak.io` };
    const refused = await request.put(`/api/employees/${employee.id}`, { data: move });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).message).toContain(`open orders (#${order.id})`);

    await request.post(`/api/orders/${order.id}/cancel`);
    const moved = await request.put(`/api/employees/${employee.id}`, { data: move });
    expect(moved.ok(), await moved.text()).toBe(true);
  });
});

test.describe('employee CSV import', () => {
  test.skip(isLive, LOCAL_ONLY);

  test('imports the good rows and lists every bad row with a reason', async ({ page }) => {
    const n = Date.now();
    const csv = [
      'name,email,can_choose_address,can_change_time,can_change_packaging,allergies,dietary',
      `Ravi Shankar,ravi.${n}@kaveri.co.in,yes,no,no,Peanuts;Dairy,Vegetarian`,
      `"Hegde, Usha ${n}",usha.${n}@kaveri.co.in,,,,,Jain`,
      `Wrong Domain,someone.${n}@gmail.com,,,,,`,
      `,noname.${n}@kaveri.co.in,maybe,,,,`,
      `Taken,harish.gowda@kaveri.co.in,,,,,`,
    ].join('\n');
    await signIn(page, 'admin@test.com');
    await page.goto('/companies/3'); // Kaveri Consulting
    await page.getByRole('button', { name: 'Import CSV' }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'employees.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await expect(page.getByText('Imported 2 employee(s). 3 row(s) were skipped:')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('row', { name: /gmail.com/ })).toContainText(
      'Email must be at @kaveri.co.in',
    );
    await expect(page.getByRole('dialog').getByRole('row', { name: /noname/ })).toContainText(
      'Name is missing',
    );
    await expect(page.getByRole('dialog').getByRole('row', { name: /harish.gowda/ })).toContainText(
      'Already an employee',
    );

    await page.keyboard.press('Escape');
    await expect(page.getByRole('cell', { name: `ravi.${n}@kaveri.co.in` })).toBeVisible();
    await expect(page.getByRole('cell', { name: `Hegde, Usha ${n}` })).toBeVisible(); // quoted comma kept
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

  test("a day that already has orders can't be made a holiday", async ({ request }) => {
    await apiSignIn(request, 'admin@test.com');
    const settings = await (await request.get('/api/settings')).json();
    const order = await createOrder(request);
    const day = (await (await request.get(`/api/orders/${order.id}`)).json()).deliveryDate;
    const res = await request.put('/api/settings', {
      data: { ...settings, holidays: [...settings.holidays, { date: day, name: 'Too late' }] },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toMatch(/Orders are already booked for .*\(\d+ orders\)/);
    await request.post(`/api/orders/${order.id}/cancel`);
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
  const csv = { csv: 'name,email\nX,x@acmeanalytics.in' };
  expect(
    (await request.post(`/api/companies/${ACME}/employees/import`, { data: csv })).status(),
  ).toBe(403);
});
