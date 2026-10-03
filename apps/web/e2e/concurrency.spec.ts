// What happens when people act at the same moment, or send nonsense.
//
// A kitchen has several cooks, dispatchers and drivers working at once, often
// on the same order, and staff sign in from more than one device. Each test
// sets up one such moment, fires the requests together, and checks that the
// result is one of the acceptable ones: nothing half done, nothing counted
// twice, and never a server error.
//
// Runs locally and on the live site. Everything it makes is marked as test
// data ("Fernleaf QA ..." companies, staff on fernleaf-qa.in), which
// qa-cleanup.ts removes when a live run ends.
import { expect, request, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import type { CompanyDetail, Drop, EmployeeMenu, OrderDetail, PricedDish } from '@fernleaf/shared';
import { freeTime, markDelivered, placedPastCutoff, todayOutForDelivery } from './db';
import { isLive, lockedDate, openDate, PASSWORD } from './helpers';
import { QA_DOMAIN } from './qa-cleanup';

const RUN = Date.now().toString(36);
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const COMPANY = `Fernleaf QA Race ${RUN}`;
const DOMAIN = `race-${RUN}.${QA_DOMAIN}`;
// A date whose cut-off has passed: the next weekday locally (the local kitchen
// works Monday to Friday), tomorrow on the live site (it cooks every day).
const locked = () =>
  isLive
    ? new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10)
    : lockedDate();

async function as(email: string) {
  const ctx = await request.newContext({ baseURL: BASE });
  const res = await ctx.post('/api/auth/login', { data: { email, password: PASSWORD } });
  expect(res.ok(), `sign in as ${email}`).toBe(true);
  return ctx;
}

/** Fires all the requests at once and waits for every one. */
const together = (...calls: (() => Promise<APIResponse>)[]) => Promise.all(calls.map((c) => c()));
const statuses = (responses: APIResponse[]) => responses.map((r) => r.status()).sort();
const noServerErrors = async (responses: APIResponse[]) => {
  for (const r of responses) expect(r.status(), `${r.url()}: ${await r.text()}`).toBeLessThan(500);
};

let admin: APIRequestContext;
const s = {
  companyId: 0,
  addresses: [] as number[],
  e1: 0, // may change time and address
  e2: 0,
  dish: undefined as PricedDish | undefined,
  driverA: { id: 0, email: `race.driver.a.${RUN}@${QA_DOMAIN}` },
  driverB: { id: 0, email: `race.driver.b.${RUN}@${QA_DOMAIN}` },
  secondAdmin: `race.admin.${RUN}@${QA_DOMAIN}`,
};

async function staff(email: string, role: string) {
  const res = await admin.post('/api/staff', {
    data: { name: `QA ${email.split('@')[0]}`, email, password: PASSWORD, role },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { id: number }).id;
}

/** An order of the dish for e1, `units` combinations (prep units), on `day` at `time`. */
async function order(day: string, units = 1, extra: Record<string, unknown> = {}) {
  const dish = s.dish!;
  const group = dish.groups.find((g) => g.required)!;
  const combos = Array.from({ length: units }, (_, i) => ({
    quantity: 1,
    optionIds: [group.options[i % group.options.length].id],
  }));
  const res = await admin.post('/api/orders', {
    data: {
      employeeId: s.e1,
      deliveryDate: day,
      deliveryTime: await freeTime(s.companyId, day),
      place: true,
      lines: [{ dishId: dish.id, quantity: units, combos }],
      ...extra,
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id: number; status: string; deliveryTime: string };
}

const detail = async (id: number) =>
  (await (await admin.get(`/api/orders/${id}`)).json()) as OrderDetail;

const unitsOf = async (orderId: number, day: string) =>
  (
    (await (await admin.get(`/api/kitchen?date=${day}`)).json()) as {
      units: { id: number; orderId: number }[];
    }
  ).units.filter((u) => u.orderId === orderId);

const dropOf = async (orderId: number, day: string) => {
  const drops = (await (await admin.get(`/api/dispatch/drops?date=${day}`)).json()) as Drop[];
  return drops.find((d) => d.orders.some((o) => o.id === orderId))!;
};

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.describe('people acting at the same moment', () => {
  test.beforeAll(async () => {
    admin = await as('admin@test.com');
    s.driverA.id = await staff(s.driverA.email, 'DRIVER');
    s.driverB.id = await staff(s.driverB.email, 'DRIVER');
    const company = await admin.post('/api/companies', {
      data: {
        name: COMPANY,
        domains: [DOMAIN],
        addresses: [
          { label: 'QA race A', text: 'Test address, not a real place' },
          { label: 'QA race B', text: 'Test address, not a real place' },
        ],
        billingName: COMPANY,
        billingEmail: `accounts@${DOMAIN}`,
        workingDays: [1, 2, 3, 4, 5, 6, 7],
        deliveryTime: '12:30',
        dispatchLeadMinutes: 60,
        defaultDriverId: s.driverA.id,
      },
    });
    expect(company.ok(), await company.text()).toBe(true);
    s.companyId = ((await company.json()) as { id: number }).id;
    for (const [name, local, may] of [
      ['QA Race One', 'one', true],
      ['QA Race Two', 'two', false],
    ] as const) {
      const res = await admin.post('/api/employees', {
        data: {
          companyId: s.companyId,
          name,
          email: `${local}@${DOMAIN}`,
          canChooseAddress: may,
          canChangeTime: may,
          canChangePackaging: may,
        },
      });
      expect(res.ok(), await res.text()).toBe(true);
    }
    const detail = (await (
      await admin.get(`/api/companies/${s.companyId}`)
    ).json()) as CompanyDetail;
    s.addresses = detail.addresses.map((a) => a.id!);
    s.e1 = detail.employees.find((e) => e.name === 'QA Race One')!.id;
    s.e2 = detail.employees.find((e) => e.name === 'QA Race Two')!.id;
    const menu = (await (
      await admin.get(`/api/menu/preview?employeeId=${s.e1}&allSecret=true`)
    ).json()) as EmployeeMenu;
    // A dish with a required choice that has at least two options, so an order
    // can have two prep units.
    s.dish = menu.categories
      .flatMap((c) => c.dishes)
      .find((d) => !d.minOrderQty && d.groups.some((g) => g.required && g.options.length > 1));
    expect(s.dish, 'a dish with two choices on the default tier').toBeTruthy();
  });

  // ---------- Signing in from several places ----------

  test('the same admin on two devices: both work; signing out of one leaves the other', async () => {
    await staff(s.secondAdmin, 'ADMIN');
    const laptop = await as(s.secondAdmin);
    const phone = await as(s.secondAdmin);
    expect((await laptop.get('/api/orders')).status()).toBe(200);
    expect((await phone.get('/api/orders')).status()).toBe(200);

    await laptop.post('/api/auth/logout');
    expect((await laptop.get('/api/orders')).status()).toBe(401);
    expect((await phone.get('/api/orders')).status()).toBe(200);
  });

  test('two admins switching staff off at the same moment: no errors, taken one at a time', async () => {
    const x = `race.x.${RUN}@${QA_DOMAIN}`;
    const y = `race.y.${RUN}@${QA_DOMAIN}`;
    const xId = await staff(x, 'ADMIN');
    const yId = await staff(y, 'ADMIN');
    const asX = await as(x);
    const asY = await as(y);
    // Each switches the other off at once. admin@test.com can still manage
    // staff either way, so the first one through is allowed; the second then
    // finds its own account switched off (401) or is also allowed.
    const results = await together(
      () => asX.put(`/api/staff/${yId}`, { data: { role: 'ADMIN', active: false } }),
      () => asY.put(`/api/staff/${xId}`, { data: { role: 'ADMIN', active: false } }),
    );
    await noServerErrors(results);
    expect(results.some((r) => r.ok())).toBe(true);
    // And admin@test.com can still manage staff.
    expect((await admin.get('/api/staff')).status()).toBe(200);
  });

  test('an account switched off while signed in on two devices is signed out of both', async () => {
    const email = `race.off.${RUN}@${QA_DOMAIN}`;
    const id = await staff(email, 'KITCHEN');
    const tablet = await as(email);
    const laptop = await as(email);
    await admin.put(`/api/staff/${id}`, { data: { role: 'KITCHEN', active: false } });
    expect((await tablet.get('/api/kitchen')).status()).toBe(401);
    expect((await laptop.get('/api/kitchen')).status()).toBe(401);
  });

  test('a tampered or made-up session is simply signed out, and sent to sign in', async ({
    browser,
  }) => {
    const forged = await request.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { cookie: 'session=not-a-real-token' },
    });
    expect((await forged.get('/api/auth/me')).status()).toBe(401);
    expect((await forged.get('/api/orders')).status()).toBe(401);
    const context = await browser.newContext();
    await context.addCookies([
      { name: 'session', value: 'not-a-real-token', url: BASE, httpOnly: true, secure: true },
    ]);
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard`);
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  // ---------- Orders ----------

  test('two admins edit the same order at once: one version wins whole, never a mix', async () => {
    const second = await as(s.secondAdmin);
    const draft = await order(openDate());
    const current = await detail(draft.id);
    const edit = (quantity: number) => ({
      employeeId: s.e1,
      deliveryDate: current.deliveryDate,
      deliveryTime: current.deliveryTime,
      place: false,
      lines: [
        {
          dishId: s.dish!.id,
          quantity,
          combos: [
            { quantity, optionIds: [s.dish!.groups.find((g) => g.required)!.options[0].id] },
          ],
        },
      ],
    });
    const results = await together(
      () => admin.put(`/api/orders/${draft.id}`, { data: edit(2) }),
      () => second.put(`/api/orders/${draft.id}`, { data: edit(3) }),
    );
    await noServerErrors(results);
    const after = await detail(draft.id);
    expect(after.lines).toHaveLength(1); // not two sets of lines
    expect([2, 3]).toContain(after.lines[0].quantity);
    expect(after.lines[0].combos.reduce((n, c) => n + c.quantity, 0)).toBe(after.lines[0].quantity);
    expect(after.total).toBe(after.lines.reduce((sum, l) => sum + l.total, 0));
  });

  test('one admin edits an order while another cancels it: it ends cancelled, and whole', async () => {
    const second = await as(s.secondAdmin);
    const draft = await order(openDate());
    const current = await detail(draft.id);
    const results = await together(
      () =>
        admin.put(`/api/orders/${draft.id}`, {
          data: {
            employeeId: s.e1,
            deliveryDate: current.deliveryDate,
            deliveryTime: current.deliveryTime,
            place: true,
            lines: current.lines.map((l) => ({
              dishId: l.dishId,
              quantity: l.quantity,
              combos: l.combos.map((c) => ({
                quantity: c.quantity,
                optionIds: c.choices.map((ch) => ch.optionId),
              })),
            })),
          },
        }),
      () => second.post(`/api/orders/${draft.id}/cancel`),
    );
    await noServerErrors(results);
    const after = await detail(draft.id);
    expect(after.status).toBe('CANCELLED'); // either way round, it ends cancelled
    expect(after.total).toBe(after.lines.reduce((sum, l) => sum + l.total, 0));
  });

  test('two admins run the cut-off for the same date at once: every order confirmed exactly once', async () => {
    const second = await as(s.secondAdmin);
    const day = locked();
    const ids = [
      await placedPastCutoff(s.e1, day),
      await placedPastCutoff(s.e1, day),
      await placedPastCutoff(s.e1, day),
    ];
    const results = await together(
      () => admin.post('/api/orders/cutoff/run', { data: { date: day } }),
      () => second.post('/api/orders/cutoff/run', { data: { date: day } }),
    );
    await noServerErrors(results);
    for (const id of ids) {
      const o = await detail(id);
      expect(o.status, `order #${id}`).toBe('CONFIRMED');
      expect(o.timeline.filter((t) => t.label === 'Confirmed')).toHaveLength(1);
      expect(o.driver?.name).toBe(`QA race.driver.a.${RUN}`); // the company's default driver
    }
    // Between them the two runs confirmed each order once at most (the
    // automatic sweep may have got to some first).
    const confirmed = await Promise.all(
      results.map(async (r) => ((await r.json()) as { confirmed: number }).confirmed),
    );
    expect(confirmed.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(ids.length);
  });

  // ---------- Kitchen ----------

  test('two cooks finish the last two units of an order at once: it becomes ready exactly once', async () => {
    const day = locked();
    const o = await order(day, 2);
    const [u1, u2] = await unitsOf(o.id, day);
    const cookA = await as('kitchen@test.com');
    const cookB = await as('kitchen@test.com');
    const results = await together(
      () => cookA.post(`/api/kitchen/units/${u1.id}/done`),
      () => cookB.post(`/api/kitchen/units/${u2.id}/done`),
    );
    expect(statuses(results)).toEqual([200, 200]);
    const after = await detail(o.id);
    expect(after.timeline.filter((t) => t.label === 'Kitchen ready')).toHaveLength(1);
    expect(after.timeline.map((t) => t.label)).toContain('Kitchen started');
  });

  test('two cooks press Done on the same unit at once: it is done once', async () => {
    const day = locked();
    const o = await order(day, 1);
    const [unit] = await unitsOf(o.id, day);
    const cooks = [await as('kitchen@test.com'), await as('kitchen@test.com')];
    const results = await together(
      ...cooks.map((c) => () => c.post(`/api/kitchen/units/${unit.id}/done`)),
    );
    expect(statuses(results)).toEqual([200, 409]);
  });

  test('a cook marks a unit while an admin cooks the whole order: all done, no errors', async () => {
    const day = locked();
    const o = await order(day, 2);
    const [unit] = await unitsOf(o.id, day);
    const cook = await as('kitchen@test.com');
    const results = await together(
      () => cook.post(`/api/kitchen/units/${unit.id}/done`),
      () => admin.post(`/api/kitchen/orders/${o.id}/complete`),
    );
    await noServerErrors(results);
    expect((await unitsOf(o.id, day)).length).toBe(2);
    const after = await detail(o.id);
    expect(after.timeline.filter((t) => t.label === 'Kitchen ready')).toHaveLength(1);
  });

  test('a cook works an order while an admin cancels it: it ends cancelled, no errors', async () => {
    const day = locked();
    const o = await order(day, 1);
    const [unit] = await unitsOf(o.id, day);
    const cook = await as('kitchen@test.com');
    const results = await together(
      () => cook.post(`/api/kitchen/units/${unit.id}/done`),
      () => admin.post(`/api/orders/${o.id}/cancel`),
    );
    await noServerErrors(results);
    expect((await detail(o.id)).status).toBe('CANCELLED');
  });

  // ---------- Dispatch ----------

  test('two dispatchers pick different drivers for the same drop at once: it stays one drop, one driver', async () => {
    const day = locked();
    const first = await order(day, 1);
    // The same time and address: the same drop.
    await order(day, 1, { deliveryTime: first.deliveryTime });
    const drop = await dropOf(first.id, day);
    expect(drop.orders).toHaveLength(2);
    const [d1, d2] = [await as('dispatch@test.com'), await as('dispatch@test.com')];
    const results = await together(
      () => d1.post('/api/dispatch/assign', { data: { drop: drop.ref, driverId: s.driverA.id } }),
      () => d2.post('/api/dispatch/assign', { data: { drop: drop.ref, driverId: s.driverB.id } }),
    );
    expect(statuses(results)).toEqual([200, 200]); // one after the other, never interleaved
    const after = await dropOf(first.id, day);
    expect(after.orders).toHaveLength(2);
    expect([s.driverA.id, s.driverB.id]).toContain(after.driver?.id); // null would mean split
  });

  test('one dispatcher sends a drop out while another changes its driver: it leaves with a driver', async () => {
    const day = locked();
    const o = await order(day, 1);
    await admin.post(`/api/kitchen/orders/${o.id}/complete`);
    const dispatch = await as('dispatch@test.com');
    let drop = await dropOf(o.id, day);
    expect(
      (
        await dispatch.post('/api/dispatch/step', {
          data: { drop: drop.ref, step: 'dispatch-ready' },
        })
      ).ok(),
    ).toBe(true);
    const other = await as('dispatch@test.com');
    const results = await together(
      () => dispatch.post('/api/dispatch/step', { data: { drop: drop.ref, step: 'out' } }),
      () =>
        other.post('/api/dispatch/assign', { data: { drop: drop.ref, driverId: s.driverB.id } }),
    );
    await noServerErrors(results);
    drop = await dropOf(o.id, day);
    expect(drop.stage).toBe('out');
    expect(drop.driver).not.toBeNull();
    // Once it's out, the driver can't change.
    expect(
      (
        await other.post('/api/dispatch/assign', {
          data: { drop: drop.ref, driverId: s.driverA.id },
        })
      ).status(),
    ).toBe(409);
  });

  test('two dispatchers press the same step at once: it happens once', async () => {
    const day = locked();
    const o = await order(day, 1);
    await admin.post(`/api/kitchen/orders/${o.id}/complete`);
    const drop = await dropOf(o.id, day);
    const [d1, d2] = [await as('dispatch@test.com'), await as('dispatch@test.com')];
    const results = await together(
      () => d1.post('/api/dispatch/step', { data: { drop: drop.ref, step: 'dispatch-ready' } }),
      () => d2.post('/api/dispatch/step', { data: { drop: drop.ref, step: 'dispatch-ready' } }),
    );
    expect(statuses(results)).toEqual([200, 409]);
  });

  test('an admin moves an order to another time while dispatch steps its drop: no errors, nothing lost', async () => {
    const day = locked();
    const o = await order(day, 1);
    await admin.post(`/api/kitchen/orders/${o.id}/complete`);
    const drop = await dropOf(o.id, day);
    const dispatch = await as('dispatch@test.com');
    const newTime = await freeTime(s.companyId, day);
    const results = await together(
      () =>
        dispatch.post('/api/dispatch/step', { data: { drop: drop.ref, step: 'dispatch-ready' } }),
      () =>
        admin.put(`/api/orders/${o.id}/delivery`, {
          data: { deliveryTime: newTime, addressId: s.addresses[0], packagingTypeId: null },
        }),
    );
    await noServerErrors(results);
    const after = await detail(o.id);
    expect(after.status).toBe('CONFIRMED');
    expect(after.deliveryTime).toBe(newTime);
    // It's in exactly one drop, at its new time.
    expect((await dropOf(o.id, day)).ref.time).toBe(newTime);
  });

  test('dispatch sends a drop out while an admin changes its delivery time: one or the other', async () => {
    const day = locked();
    const o = await order(day, 1);
    await admin.post(`/api/kitchen/orders/${o.id}/complete`);
    const dispatch = await as('dispatch@test.com');
    const drop = await dropOf(o.id, day);
    expect(
      (
        await dispatch.post('/api/dispatch/step', {
          data: { drop: drop.ref, step: 'dispatch-ready' },
        })
      ).ok(),
    ).toBe(true);
    const newTime = await freeTime(s.companyId, day);
    const results = await together(
      () => dispatch.post('/api/dispatch/step', { data: { drop: drop.ref, step: 'out' } }),
      () =>
        admin.put(`/api/orders/${o.id}/delivery`, {
          data: { deliveryTime: newTime, addressId: s.addresses[0], packagingTypeId: null },
        }),
    );
    await noServerErrors(results);
    expect(results.filter((r) => r.ok())).toHaveLength(1);
    const after = await detail(o.id);
    const left = after.timeline.some((t) => t.label === 'Out for delivery');
    // Left at the old time, or stayed and moved to the new one: never left *and* moved.
    expect(left ? after.deliveryTime === o.deliveryTime : after.deliveryTime === newTime).toBe(
      true,
    );
  });

  // ---------- Drivers ----------

  test('two drivers out at once: each sees and delivers only their own drops', async () => {
    const a = await todayOutForDelivery(s.driverA.email, s.e1);
    const b = await todayOutForDelivery(s.driverB.email, s.e1);
    const [phoneA, phoneB] = [await as(s.driverA.email), await as(s.driverB.email)];
    const mine = async (ctx: APIRequestContext) =>
      ((await (await ctx.get('/api/deliveries')).json()) as Drop[]).map((d) => d.ref.time);
    expect(await mine(phoneA)).toContain(a.time);
    expect(await mine(phoneA)).not.toContain(b.time);
    expect(await mine(phoneB)).toContain(b.time);
    expect(await mine(phoneB)).not.toContain(a.time);

    const ref = (d: typeof a) => ({
      companyId: d.companyId,
      addressId: d.addressId,
      date: d.date,
      time: d.time,
    });
    // Each tries the other's drop: refused.
    expect(
      (
        await phoneA.post('/api/deliveries/delivered', { data: { drop: ref(b), note: '' } })
      ).status(),
    ).toBe(403);
    // Both deliver their own at the same moment: both fine.
    const results = await together(
      () => phoneA.post('/api/deliveries/delivered', { data: { drop: ref(a), note: 'A' } }),
      () => phoneB.post('/api/deliveries/delivered', { data: { drop: ref(b), note: 'B' } }),
    );
    expect(statuses(results)).toEqual([200, 200]);
    expect((await detail(a.orderId)).deliveryNote).toBe('A');
    expect((await detail(b.orderId)).deliveryNote).toBe('B');
  });

  test('the same driver on two phones delivers the same drop at once: delivered once', async () => {
    const d = await todayOutForDelivery(s.driverA.email, s.e1);
    const ref = { companyId: d.companyId, addressId: d.addressId, date: d.date, time: d.time };
    const [p1, p2] = [await as(s.driverA.email), await as(s.driverA.email)];
    const results = await together(
      () => p1.post('/api/deliveries/delivered', { data: { drop: ref, note: 'phone 1' } }),
      () => p2.post('/api/deliveries/delivered', { data: { drop: ref, note: 'phone 2' } }),
    );
    expect(statuses(results)).toEqual([200, 409]);
    const after = await detail(d.orderId);
    expect(['phone 1', 'phone 2']).toContain(after.deliveryNote);
    expect(after.timeline.filter((t) => t.label === 'Delivered')).toHaveLength(1);
  });

  test('a driver delivers while an admin cancels the order: it ends one or the other, never both', async () => {
    const d = await todayOutForDelivery(s.driverA.email, s.e1);
    const ref = { companyId: d.companyId, addressId: d.addressId, date: d.date, time: d.time };
    const phone = await as(s.driverA.email);
    const results = await together(
      () => phone.post('/api/deliveries/delivered', { data: { drop: ref, note: '' } }),
      () => admin.post(`/api/orders/${d.orderId}/cancel`),
    );
    await noServerErrors(results);
    const after = await detail(d.orderId);
    expect(['DELIVERED', 'CANCELLED']).toContain(after.status);
    // Exactly one of the two went through.
    expect(results.filter((r) => r.ok())).toHaveLength(1);
  });

  // ---------- Billing ----------

  test('two admins invoice overlapping orders at once: each order on one invoice, no stray invoice', async () => {
    const second = await as(s.secondAdmin);
    const day = locked();
    const [a, b, c] = [await order(day), await order(day), await order(day)];
    const before = (await (await admin.get(`/api/billing/companies/${s.companyId}`)).json()) as {
      invoices: unknown[];
    };
    const results = await together(
      () =>
        admin.post('/api/billing/invoices', {
          data: { companyId: s.companyId, orderIds: [a.id, b.id] },
        }),
      () =>
        second.post('/api/billing/invoices', {
          data: { companyId: s.companyId, orderIds: [b.id, c.id] },
        }),
    );
    expect(statuses(results)).toEqual([201, 409]);
    const after = (await (await admin.get(`/api/billing/companies/${s.companyId}`)).json()) as {
      invoices: { id: number; total: number }[];
    };
    expect(after.invoices.length).toBe(before.invoices.length + 1); // the loser left nothing behind
    const invoiceOf = async (id: number) => (await detail(id)).invoice?.id ?? null;
    expect(await invoiceOf(b.id)).toBe(after.invoices[0].id);
    // Exactly one of A and C went with B.
    expect([await invoiceOf(a.id), await invoiceOf(c.id)].filter(Boolean)).toHaveLength(1);

    // Two admins mark it paid at once: once.
    const paid = await together(
      () => admin.post(`/api/billing/invoices/${after.invoices[0].id}/paid`),
      () => second.post(`/api/billing/invoices/${after.invoices[0].id}/paid`),
    );
    expect(paid.filter((r) => r.ok())).toHaveLength(1);
    expect(paid.filter((r) => r.status() === 409)).toHaveLength(1);
  });

  test('two admins credit the same delivered order at once: never more than it cost', async () => {
    const second = await as(s.secondAdmin);
    const o = await order(locked());
    await markDelivered(o.id);
    const { total } = await detail(o.id);
    const most = Math.ceil(total * 0.6);
    const results = await together(
      () =>
        admin.post(`/api/billing/orders/${o.id}/credit`, {
          data: { amount: most, reason: 'QA race 1' },
        }),
      () =>
        second.post(`/api/billing/orders/${o.id}/credit`, {
          data: { amount: most, reason: 'QA race 2' },
        }),
    );
    expect(statuses(results)).toEqual([201, 400]);
    const credited = (await detail(o.id)).adjustments.reduce((sum, a) => sum + a.amount, 0);
    expect(-credited).toBeLessThanOrEqual(total);
  });

  // ---------- Setting up ----------

  test('two admins give two companies the same domain at once: only one gets it', async () => {
    const domain = `dup-${RUN}.${QA_DOMAIN}`;
    const company = (name: string) => ({
      name,
      domains: [domain],
      addresses: [{ label: 'QA', text: 'Test address' }],
      billingName: name,
      billingEmail: `accounts@${domain}`,
      workingDays: [1, 2, 3, 4, 5],
      deliveryTime: '12:30',
      dispatchLeadMinutes: 60,
    });
    const second = await as(s.secondAdmin);
    const results = await together(
      () => admin.post('/api/companies', { data: company(`Fernleaf QA Dup A ${RUN}`) }),
      () => second.post('/api/companies', { data: company(`Fernleaf QA Dup B ${RUN}`) }),
    );
    await noServerErrors(results);
    expect(results.filter((r) => r.ok())).toHaveLength(1);
    const companies = (await (await admin.get('/api/companies')).json()) as { domains: string[] }[];
    expect(companies.filter((c) => c.domains.includes(domain))).toHaveLength(1);
  });

  test('two admins add staff with the same email at once: one account', async () => {
    const email = `race.same.${RUN}@${QA_DOMAIN}`;
    const second = await as(s.secondAdmin);
    const body = { name: 'QA same', email, password: PASSWORD, role: 'KITCHEN' };
    const results = await together(
      () => admin.post('/api/staff', { data: body }),
      () => second.post('/api/staff', { data: body }),
    );
    expect(statuses(results)).toEqual([201, 409]);
  });

  test('two admins save the same company at once: one version wins, no errors', async () => {
    const second = await as(s.secondAdmin);
    const current = (await (
      await admin.get(`/api/companies/${s.companyId}`)
    ).json()) as CompanyDetail;
    const body = (instructions: string) => ({ ...current, driverInstructions: instructions });
    const results = await together(
      () => admin.put(`/api/companies/${s.companyId}`, { data: body('QA version one') }),
      () => second.put(`/api/companies/${s.companyId}`, { data: body('QA version two') }),
    );
    await noServerErrors(results);
    const after = (await (
      await admin.get(`/api/companies/${s.companyId}`)
    ).json()) as CompanyDetail;
    expect(['QA version one', 'QA version two']).toContain(after.driverInstructions);
    expect(after.domains).toEqual([DOMAIN]);
    expect(after.addresses.map((a) => a.id)).toEqual(s.addresses); // addresses kept, not duplicated
  });
});

// ---------- Nonsense in, sensible errors out ----------

test.describe('odd input never breaks anything', () => {
  test('ids that cannot exist are "not found", never a crash', async () => {
    const ctx = await as('admin@test.com');
    for (const id of ['abc', '-1', '0', '1.5', '99999999999']) {
      for (const path of [
        `/api/orders/${id}`,
        `/api/dishes/${id}`,
        `/api/companies/${id}`,
        `/api/billing/invoices/${id}`,
        `/api/tiers/${id}/grid`,
      ]) {
        const res = await ctx.get(path);
        expect(res.status(), path).toBe(404);
      }
      expect((await ctx.post(`/api/kitchen/units/${id}/done`)).status()).toBe(404);
    }
  });

  test('numbers too big are refused with a message a person can act on', async () => {
    const ctx = await as('admin@test.com');
    const huge = 99_999_999_999;
    const message = async (res: APIResponse) => {
      expect(res.status(), await res.text()).toBe(400);
      return ((await res.json()) as { message: string }).message;
    };
    expect(
      await message(
        await ctx.put('/api/tiers/1/prices', { data: { kind: 'dish', id: 1, price: huge } }),
      ),
    ).toBe('At most ₹1,00,000');
    expect(
      await message(
        await ctx.post('/api/options', { data: { name: `QA huge ${RUN}`, costPrice: huge } }),
      ),
    ).toBe('At most ₹1,00,000');
    const tooMany = await ctx.post('/api/orders', {
      data: {
        employeeId: 1,
        deliveryDate: openDate(),
        lines: [
          { dishId: 1, quantity: 2_000_000, combos: [{ quantity: 2_000_000, optionIds: [] }] },
        ],
      },
    });
    expect(tooMany.status()).toBe(400);
    const fields = ((await tooMany.json()) as { fieldErrors: Record<string, string> }).fieldErrors;
    expect(fields['lines.0.quantity']).toBe('At most 10,000');
    // Within the quantity limit but over ₹10,00,000 for one order: refused too.
    if (s.dish && s.dish.price * 10_000 > 100_000_000) {
      const big = await ctx.post('/api/orders', {
        data: {
          employeeId: s.e1,
          deliveryDate: openDate(),
          lines: [
            {
              dishId: s.dish.id,
              quantity: 10_000,
              combos: [
                {
                  quantity: 10_000,
                  optionIds: [s.dish.groups.find((g) => g.required)!.options[0].id],
                },
              ],
            },
          ],
        },
      });
      expect(await message(big)).toMatch(/can't be over ₹10,00,000/);
    }
    // Ids too big in a body or a filter: refused, not a crash.
    expect((await ctx.get(`/api/orders?companyId=${huge}`)).status()).toBe(400);
    expect(
      (
        await ctx.post('/api/employees', {
          data: { companyId: huge, name: 'x', email: 'x@acmeanalytics.in' },
        })
      ).status(),
    ).toBeLessThan(500);
    expect((await ctx.get('/api/orders?page=abc')).status()).toBe(400);
  });

  test('names with HTML in them are shown as text, never run', async ({ page }) => {
    const ctx = await as('admin@test.com');
    const companies = (await (await ctx.get('/api/companies')).json()) as {
      id: number;
      name: string;
    }[];
    const race = companies.find((c) => c.name === COMPANY);
    test.skip(!race, 'the race company is made by the tests above');
    const name = `<b onmouseover="alert(1)">QA bold ${RUN}</b>`;
    const res = await ctx.post('/api/employees', {
      data: { companyId: race!.id, name, email: `html.${RUN}@${DOMAIN}` },
    });
    expect(res.ok(), await res.text()).toBe(true);
    let dialogs = 0;
    page.on('dialog', async (d) => {
      dialogs++;
      await d.dismiss();
    });
    await page.goto(`${BASE}/login`);
    await page.getByLabel('Email').fill('admin@test.com');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/dashboard/);
    await page.goto(`${BASE}/companies/${race!.id}`);
    // The literal text, tags and all, in the employee list.
    const cell = page.getByRole('cell', { name, exact: true });
    await expect(cell).toBeVisible();
    await cell.hover();
    expect(dialogs).toBe(0);
  });
});
