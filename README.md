# Fernleaf Kitchen admin panel

The internal admin panel for Fernleaf Kitchen, a (fictional) commercial kitchen that runs corporate meal programs. Companies sign up, staff order boxed lunches on behalf of employees, the kitchen cooks them, dispatch sends them out, drivers deliver them, and the company gets the bill.

Built for the Heizen engineering round with **Next.js + NestJS + Prisma (PostgreSQL)**.

**Live:** https://fernleaf.vercel.app

| Role | Email | Password |
|---|---|---|
| Admin | admin@test.com | Test@1234 |
| Kitchen | kitchen@test.com | Test@1234 |
| Dispatch | dispatch@test.com | Test@1234 |
| Driver | driver@test.com | Test@1234 |

The API runs on Render's free tier. A pinger keeps it awake, but if the first request takes up to a minute, the server was asleep. It's fine after that.

---

## Contents

1. [Running it locally](#running-it-locally)
2. [How it's put together](#how-its-put-together)
3. [Data model](#data-model)
4. [How the main rules work](#how-the-main-rules-work)
5. [Key decisions and trade-offs](#key-decisions-and-trade-offs)
6. [Dashboards: what each number means](#dashboards-what-each-number-means)
7. [What I built, what I skipped, and why](#what-i-built-what-i-skipped-and-why)
8. [Ambiguous requirements and how I read them](#ambiguous-requirements-and-how-i-read-them)
9. [Tests](#tests)
10. [Demo data](#demo-data)

---

## Running it locally

You need Node 22+ and Docker (for Postgres).

```bash
git clone https://github.com/shingaladeep23-gif/Heizen-Engineering-Round.git
cd Heizen-Engineering-Round
npm install                # also builds the shared package
docker compose up -d       # Postgres 17 on localhost:5432
```

Create `apps/api/.env`:

```
DATABASE_URL="postgresql://fernleaf:fernleaf@localhost:5432/fernleaf"
JWT_SECRET="anything-long-and-random"
# DEMO_MODE=true          # optional: generate two weeks of orders (see "Demo data")
```

Then:

```bash
cd apps/api && npx prisma migrate deploy && cd ../..
npm run dev:api            # NestJS on http://localhost:4000
npm run dev:web            # Next.js on http://localhost:3000
```

The API creates the four test accounts and the demo catalogue on first start, so you can sign in straight away.

Useful scripts from the repo root:

| Command | What it does |
|---|---|
| `npm run check` | lint + type-check + unit tests + Playwright, the same thing the pre-commit hook runs |
| `npm test` | unit tests (Vitest) |
| `npm run test:e2e` | Playwright against production builds of both apps (Postgres must be running) |
| `BASE_URL=https://fernleaf.vercel.app npm run test:e2e` | the same suite against the live site; tests that change data skip themselves |

---

## How it's put together

```
Browser ──► Vercel: Next.js (apps/web)
               │  /api/* is forwarded (a Next.js rewrite) ──►  Render: NestJS (apps/api) ──► Neon: PostgreSQL
               │                                                   │
               └── both import packages/shared (types, zod schemas, the permission map)
```

**One repo, npm workspaces, three parts:**

- `apps/web`: Next.js 16, Mantine for the UI, TanStack Query for data. Every page is a client component that calls the API over HTTP. There is no business logic in Next.js and no server actions.
- `apps/api`: NestJS 12 with Prisma 6. One folder per area: `auth`, `catalogue`, `pricing`, `menu`, `companies`, `orders`, `kitchen`, `dispatch`, `billing`, `settings`, `dashboard`, `demo-data`.
- `packages/shared`: zod schemas used by both sides (the API enforces them, the forms reuse them), response types, money formatting, and the role → permission map.

**Why the browser only talks to the Next.js domain:** the login cookie is httpOnly. If the browser called Render directly, that would be a third-party cookie, and some browsers block those. With the rewrite, the cookie is first-party and the setup stays simple.

**Rules live in small pure functions with unit tests**, and the services call them:

| File | Rules |
|---|---|
| `pricing/price-rules.ts` | tier resolution, derived prices, rounding up to 5 paise |
| `menu/menu-rules.ts` | what one employee can order, priced on their tier |
| `orders/calendar.ts` | IST dates, cut-off counting, planned kitchen/dispatch times |
| `orders/order-rules.ts` | combinations, required groups, minimum quantities, line prices |
| `kitchen/kitchen-rules.ts` | late / at-risk / done |
| `dispatch/dispatch-rules.ts` | drop stage, step order, on-time |
| `billing/billing-rules.ts` | billable statuses, invoice totals, credit limits |

**Permissions.** `packages/shared/src/permissions.ts` is the only file that knows role names. Endpoints say `@Can('orders.manage')`, never `role === 'ADMIN'`, and one global guard checks every request on the server. Adding a role means adding one entry to that map (plus the enum value in the schema, and a dashboard entry, which TypeScript will insist on).

**Errors** always come back as `{ message, fieldErrors? }`: validation from the zod pipe, rule breaks from the services, and database errors through one exception filter. Forms put field errors next to the field and show the message as a toast.

---

## Data model

```mermaid
erDiagram
    Company ||--o{ CompanyDomain : "email domains"
    Company ||--o{ Address : "delivers to"
    Company ||--o{ CompanyHoliday : "closed on"
    Company ||--o{ Employee : employs
    Company }o--o| PriceTier : "priced on"
    Company }o--o{ MenuCategory : hides
    Company }o--o{ MenuItem : hides
    Company ||--o{ Order : "is billed for"
    Company ||--o{ Invoice : receives

    Employee ||--o{ Order : "orders for"
    Employee }o--o{ Allergen : "allergic to"
    Employee }o--o{ DietaryTag : prefers

    Dish ||--o{ OptionGroup : has
    OptionGroup ||--o{ OptionGroupOption : lists
    Option ||--o{ OptionGroupOption : "appears in"
    Dish }o--o| Station : "cooked at"
    Dish }o--o{ Allergen : contains
    Option }o--o{ Allergen : contains

    PriceTier ||--o{ DishPrice : "typed prices"
    PriceTier ||--o{ OptionPrice : "typed prices"
    PriceTier }o--o| PriceTier : "derived from"

    MenuCategory ||--o{ MenuItem : contains
    MenuItem }o--|| Dish : shows

    Order ||--o{ OrderLine : contains
    OrderLine ||--o{ OrderCombo : "split into (prep units)"
    Order }o--|| Address : "delivered to"
    Order }o--o| User : "driven by"
    Order }o--o| Invoice : "billed on (at most one)"
    Order ||--o{ Adjustment : "credits"
    Adjustment }o--o| Invoice : "billed on"
```

The full schema with comments is in `apps/api/prisma/schema.prisma`. The ideas that matter:

- **Money is whole paise** (`Int`) everywhere. Floats never touch a price.
- **An order line is a frozen record.** `OrderLine` keeps the dish name and price, and each `OrderCombo` keeps its unit price and the chosen options (names and prices, as JSON). Editing the catalogue or prices later can't change a past order.
- **`OrderCombo` is also the kitchen's prep unit**: each distinct combination on a line is cooked as one unit, with its own `startedAt` and `doneAt`.
- **A price tier is either typed in or derived** (`base` = cost or another tier, times `factor`). `DishPrice` and `OptionPrice` hold typed prices; on a derived tier they're overrides.
- **The default tier lives on the single `Settings` row**, so there can only ever be one.
- **An order copies its `companyId`** when created. Moving an employee to another company later doesn't move their old orders' bills.
- **Planned kitchen-ready and dispatch-ready times aren't stored.** They're worked out from the delivery time whenever they're shown, so they always follow it when it changes.
- **The timeline is the order's own timestamps** (placed, confirmed, kitchen started/ready, dispatch ready, out, delivered, cancelled, rejected). Audit logs were out of scope.
- **Drops aren't stored.** A drop is computed: confirmed orders with the same company, address and exact delivery time. An admin changing an order's time automatically moves it to the right drop.
- **`Order.invoiceId` is a single column**, so an order can be on at most one invoice by construction. Later money changes are `Adjustment` rows (negative = credit) that go on the company's next invoice.

---

## How the main rules work

**Pricing (4.3).** An employee is priced on their company's tier, or on the default tier. For each dish and option:

1. If the tier has a typed price (an override, on a derived tier), use it.
2. If the tier is derived, take the base (cost, or the base tier's typed price), multiply by the factor, and **round up to the next 5 paise**. The factor is scaled to an integer first (1.15 → 11500), so the maths stays exact.
3. Otherwise there's no price, and the dish or option is **left off that employee's menu entirely**. If that empties a required option group, the whole dish disappears, because it can't be ordered.

**Cut-off (4.6).** Orders for a delivery date lock at the configured time, N **kitchen** working days before it, skipping kitchen holidays and days off. With 2 days at 16:00, a Wednesday locks on Monday at 16:00. Company calendars decide which days a company can receive deliveries, but they never move the cut-off. When a cut-off passes, drafts for that date are cancelled and placed orders are confirmed. That runs every minute, again before order lists and boards load (free hosting can be asleep when the timer should fire), and on demand from the Orders page for any past cut-off. It only touches orders still in DRAFT or PLACED, so running it twice is harmless.

**Placing an order.** The server checks everything, whatever the form did:
- the date is open for both the company and the kitchen
- time, address and packaging only differ from the company defaults if the employee is allowed to change them
- every dish is on that employee's menu
- combination quantities add up exactly to the line quantity
- each combination fills every required group, within max choices
- the minimum quantity is met
- no two combinations on a line have the same choices

The server re-prices everything itself; the form's totals are only a preview.

**Kitchen (4.7).** Each combination is a prep unit at its dish's station (or "Unassigned"). Only confirmed orders can be worked. Start and done can't be repeated, and finishing an unstarted unit records the start too. "Kitchen started" is the first unit's start; "kitchen ready" is set only when every unit is done. Planned times are worked back from delivery: dispatch-ready = delivery − the company's minutes, and kitchen-ready = dispatch-ready − the kitchen buffer (30 minutes, a setting).

**Dispatch (4.8).** A drop moves through ready to go → out for delivery → delivered as one. Each step needs the previous one on *every* order in the drop, can't be repeated, and "out" also needs a driver. A confirmed order starts with its company's default driver, and dispatch can change it per drop. "On time" means delivered no later than the delivery time plus a grace period (10 minutes, a setting). It's stored on the order at the moment of delivery.

**Billing (4.9).** See [the decision on invoiced orders](#key-decisions-and-trade-offs).

**Concurrency (section 7).** Status changes are compare-and-set (`UPDATE … WHERE status = what I read`), so if two people cancel the same order, one wins and the other gets "someone else just changed this order". Kitchen actions lock the order row first, so two cooks can't both finish the same unit, and the last two units of an order can't both miss "kitchen ready". Dispatch steps lock every order in the drop. Invoicing claims orders with `WHERE invoiceId IS NULL`, so two people invoicing the same order can't both succeed. Each of these is tested with simultaneous requests.

---

## Key decisions and trade-offs

**Time zone: IST (Asia/Kolkata).** It has no daylight saving, so converting is one fixed offset (+5:30) and I didn't need a time-zone library. All date logic uses UTC arithmetic plus that offset, so the server's own time zone (Render runs in UTC) doesn't matter. The browser shows every time in IST, whatever the viewer's time zone.

**Currency: INR**, stored as paise. The spec's examples are in dollars and cents, so "round up to the next 5 cents" became "round up to the next 5 paise" (₹2.11 → ₹2.15).

**Changes after an order is invoiced: credits, not edits.** An invoice's total is stored when it's created and never changes. If an invoiced order is cancelled or rejected, a credit for what's left on it (its total minus any earlier credits) goes onto the company's next invoice. A delivered order that turned out short gets a credit too, capped at what the order cost. Changes that don't involve money (time, address, packaging) are simply allowed. I chose this over freezing invoiced orders, or voiding and redoing invoices, because it covers all three cases the spec mentions, even after an invoice is paid, and it's how real billing works.

**JWT in an httpOnly cookie, user reloaded on every request.** Page JavaScript can't read the token. Reloading the user costs one indexed lookup per request, but deactivating someone or changing their role takes effect immediately.

**Prisma 6 with relation joins.** Prisma's newest release was still a release candidate, so I stayed on the stable line. The live menu preview first took 5–8 seconds: Prisma's default runs one query per level of nesting, and each one crosses from Render to Neon. Turning on `relationJoins` makes a nested read a single SQL query (the menu went from 12 queries to 1), and the kitchen board loads 400 orders (800 prep units) in about 0.15 s locally.

**Mantine and TanStack Query.** Ready-made tables, forms, date and time inputs, modals and notifications meant much less UI code for me to write and explain. TanStack Query handles caching, refetching and the boards' auto-refresh.

**The browser's own date input** (`type="date"`) for delivery dates. Less code, it works well on phones, and its value is already `YYYY-MM-DD`.

**Delivery photos are stored as small JPEG data URLs on the order.** The browser shrinks them to 1024 px first (about 100–200 KB). No file storage service to set up. The ceiling: it doesn't scale, and object storage is the obvious next step.

**Demo data is generated, and refreshed while the site is up.** See [Demo data](#demo-data).

---

## Dashboards: what each number means

Everything is grouped by **delivery date in IST**, because that's how the kitchen works. "Billable" means CONFIRMED or DELIVERED. Drafts and placed orders aren't owed yet, and cancelled or rejected orders aren't owed at all.

### Admin: "is the business healthy, and does anything need me?"

| Figure | How it's calculated |
|---|---|
| Orders today | Billable orders with today's delivery date. |
| Value today | Sum of those orders' totals. |
| Delivered so far | How many of those are DELIVERED. |
| Drops running late | Today's drops that haven't left by their planned dispatch time, or were delivered late. Same rule as the Dispatch board. |
| Not invoiced yet | Billable orders with no invoice, plus credits not yet on an invoice (negative). Credits on orders cancelled before ever being invoiced are ignored, since there was no charge to take back. Same number as the Billing page. |
| Unpaid invoices | Sum of totals of invoices with no paid date, plus how many and how many are overdue. |
| Overdue | Unpaid, and created more than **14 days** ago. That's my assumed payment term; the spec doesn't give one. |
| Paid in the last 30 days | Sum of totals of invoices marked paid in the last 30 days, by paid date. |
| Booked for the next 7 days | Totals of CONFIRMED and PLACED orders delivering tomorrow to 7 days out. Drafts aren't counted, because they're not commitments. |
| Last 7 days | Delivery dates from 7 days ago to yesterday (today isn't finished). **Orders** and **revenue**: billable orders and their totals. **On time**: deliveries marked on time ÷ deliveries. Orders with no delivery record don't count either way, and it shows "No data" if there were none. **Cancelled / rejected**: counted separately, including drafts cancelled at cut-off. |
| Most ordered | Top 5 dishes by portions (line quantities) on billable orders delivered in the last 7 days. |
| Needs a decision | Only shows when something is wrong: late drops today, overdue invoices, and price tiers where active dishes have no price (so those companies can't see them). |

Not shown, on purpose: charts (a sentence like "86 of 107 on time" says more than a line), margins (cost prices are rough estimates typed in by hand, so a margin figure would look more precise than it is), and per-employee rankings (nobody here needs them).

### Kitchen: "what do we cook today, and what's slipping?"

Built in the browser from the kitchen board's own data for today, so the two always agree. Only **confirmed** orders count, because placed ones aren't final yet.

| Figure | How it's calculated |
|---|---|
| Portions today | Sum of quantities of all prep units for today. |
| Portions still to cook | The same, for units not marked done. |
| Late | Units not done whose planned kitchen-ready time has passed. |
| At risk | Units not done that are due within the at-risk window (30 minutes, a setting). |
| By station | The same figures per station. Dishes without a station show as "Unassigned". |
| Prep list | Units not done, added up by dish **and** choices, so "12 × Rajma Chawal Bowl (Jeera rice)" is one line to cook. |
| Next up | The five unfinished units due soonest. |
| Tomorrow so far | Portions on tomorrow's board (confirmed and placed), for prep planning. |

Not shown: costs and money (not the kitchen's job), and drivers (dispatch's).

### Dispatch: "what leaves next, what's late, who's driving?"

Built from the dispatch board's own data for today.

| Figure | How it's calculated |
|---|---|
| Drops today | Groups of confirmed or delivered orders with the same company, address and exact time. |
| Out on the road | Drops whose every order is out for delivery but not yet delivered. |
| Delivered | Drops whose every order is delivered, and how many of those were on time. |
| Running late | Same rule as the board: not out by the planned dispatch time, or delivered late. |
| Drops without a driver | Not delivered, and the orders in them don't share one assigned driver. |
| Leaving next | Drops not yet out, by planned dispatch time. |
| Drivers today | Per driver: drops assigned, and how many are delivered. |

### Driver: "where do I go next?"

Just their own drops for **today**, in time order, with the address (a map link), standing instructions, what's in each drop, and a big "Mark delivered" button that takes an optional note and photo. Built for a phone, and tested at 390 px wide.

---

## What I built, what I skipped, and why

I did the [Must] items properly first, then went over them again with tests, rather than adding the [Should] items.

**Built (all [Must] items):**
- Catalogue: dishes, options, option groups with ordering, required/optional and max choices; admin-managed allergens, dietary tags, stations and packaging; dishes deactivated, never deleted.
- Menu: ordered categories and items, active flags, per-company hiding, secret categories, and a preview as any employee.
- Pricing: named tiers, a default tier, company tiers, derived tiers (cost × or tier ×) with overrides, rounding up to 5 paise, and a whole-tier grid that highlights missing prices.
- Companies: domains (unique, no public domains), addresses, billing contact, owner, calendar and holidays, delivery defaults, tier, hidden items.
- Employees: permission flags, allergies, diet, moving companies.
- Orders: drafts, placing, editing and cancelling before the cut-off, admin-only after it, cut-off processing (automatic, idempotent, and manually triggerable), a searchable and filterable paginated list, a detail page with breakdown and timeline, admin delivery overrides, rejection.
- Kitchen board, dispatch board, driver view, billing with credits, settings, and four dashboards.
- Server-side permissions throughout, the live site with the four test accounts, and self-refreshing demo data.

**Skipped:**
- **Portions [Should]** (sizes like regular/large on an option group). It touches the schema, pricing, the order form and the kitchen board. I'd rather every [Must] be right than have portions half-done. The model has room for it: a `PortionSize` list plus a size on each group and on each combination choice.
- **CSV employee import [Should].** Same reason: it was next in line if time allowed.
- **Renaming reference list items** (allergens and the like). Add and delete only, because nothing needed rename yet.
- Everything in section 5 (payments, exports, notifications, audit logs, tax, fees, coupons and so on), as instructed.

**What I'd do next with more time:**
1. Portions, then CSV import with row-level error reporting.
2. A real audit trail: who changed what. The timeline knows *when* but not *who*.
3. Store delivery photos in object storage instead of the database.
4. Kitchen board: a per-station "cook screen" mode with bigger buttons, and push updates instead of polling every 30 s.
5. Billing: invoice PDFs, payment terms per company instead of a fixed 14 days, and partial payments.
6. Tests: more unit tests on the services themselves (they're covered through Playwright today), and running Playwright in CI on every push, not only in a local pre-commit hook.

---

## Ambiguous requirements and how I read them

| Requirement | My interpretation |
|---|---|
| Currency and "round up to the next 5 cents" | INR; round up to the next 5 paise. |
| Time zone | IST for the kitchen, cut-offs, delivery dates and "today". |
| Who uses "Rejected", and when | Only an admin, on a placed or confirmed order the kitchen hasn't started, with a reason. Not billable. |
| What happens to an invoiced order that changes | Credits on the next invoice; invoices never change (see above). |
| "Can choose their own delivery address" | Pick any of their **company's** addresses, not type in a new one. Drops and deliveries are organised around company addresses. |
| How many options per group | Each group has a "max choices" (default 1). Required means at least one. |
| Minimum order quantity | Per order line: 10 on one line meets a minimum of 10; two orders of 5 don't. |
| An option with no price on a tier | Hidden. If that leaves a required group empty, the whole dish is hidden. |
| What a tier can derive from | Cost, or a tier whose prices are typed in. No chains of derived tiers, so no cycles. Overrides are kept exactly as typed; only formula prices are rounded. |
| Which calendar a delivery date must respect | Both the company's (spec) and the kitchen's (someone has to cook that day). |
| Ordering after the cut-off | Only an admin. Placing then confirms immediately, because that date's cut-off has already run. Drafts can't be saved after the cut-off. |
| Secret categories | Not listed on an employee's menu, but staff can open them in the preview and order from them. |
| Allergies and diet | Shown as warnings on the dish ("Contains Peanuts", "Not marked Vegan"), not hidden. Staff order on the employee's behalf, and the employee might have asked for it. |
| Employee emails | Must be on one of their company's domains. Moving someone to another company needs an email on that company's domain. |
| Who can create orders | Admin only, per the role table. Kitchen and dispatch can view orders. |
| What the kitchen board shows | Confirmed orders to work on, plus placed ones greyed out ("not confirmed yet"), so the kitchen sees what's coming. |
| "Defaulting to the company's default driver" | The order is given that driver when it's confirmed; dispatch can change it per drop until it leaves. |
| "On time" | Delivered no later than the delivery time plus a grace period (10 minutes, a setting). |
| "Late and at-risk" | Late: the planned kitchen-ready time has passed. At risk: due within 30 minutes (a setting). |
| Are admins drivers? | No. Admins can do everything except have their "own" deliveries. |
| When an order became confirmed | At the cut-off moment itself, even if processing ran later, because that's when it became billable. |
| Lines after confirmation | Can't be edited, so order totals (and invoices) stay fixed. Admins can change delivery details, cancel, reject or credit. |
| Overdue invoices | Unpaid for more than 14 days. |
| "Lists are paginated on the server" | The order list, which grows without limit, is paginated on the server (20 per page) with server-side search and filters. Reference lists (dishes, options, tiers, companies, staff) are small and loaded whole. A company's "not invoiced yet" list is bounded by its billing cycle, and staff tick items across the whole list to build an invoice, so it isn't split into pages. |

---

## Tests

The spec asked for tests on the rules most likely to break. Those are the pure-function unit tests (Vitest, **46 tests** in `apps/api/src/**/*.spec.ts`):
- **cut-off calculation:** the spec's own Wednesday → Monday 16:00 example, weekends, kitchen holidays, same-day cut-off, and "today in IST" while UTC is still on yesterday
- **pricing resolution:** typed, derived from cost and from a tier, overrides, missing base, zero cost, rounding with 1.15 (which floats can't hold exactly)
- **combination counting:** the spec's 6 + 4 = 10 example, quantities that don't add up, a skipped required group, too many choices, unknown options, duplicate combinations, minimum quantity
- **invoicing:** billable statuses, invoice totals with credits, the credit cap
- kitchen unit states and dispatch step order

**Playwright** (**65 tests** in `apps/web/e2e`) drives a real browser against **production builds** of both apps and a real Postgres. It covers:
- each role's sign-in and landing page
- server-side 403s for every role on things they shouldn't touch
- creating a dish
- filling a gap in a price tier
- per-company menus
- placing an order with combinations
- the cut-off rules
- simultaneous cancels, kitchen clicks, dispatch steps and invoicing
- the whole kitchen → dispatch → driver flow, on a phone-sized screen
- billing with credits
- companies, employees and settings

A local **pre-commit hook** runs lint, type-check, unit tests and Playwright, and blocks the commit if anything fails. Every commit after the first few setup commits went through it. The same Playwright suite runs against the live site with `BASE_URL=...`; tests that would change data skip themselves there.

---

## Demo data

The spec asks for realistic data, including orders for whatever day the review happens. A one-off seed would go stale within days, so the API keeps the demo fresh when it runs with `DEMO_MODE=true` (the live site):

- **On an empty database** it creates the catalogue (15 dishes, 14 options), four price tiers, five Bengaluru companies with 29 employees, and two weeks of order history.
- **On startup and every hour** it makes sure today and the next 7 days have orders. It only fills days with **no orders at all**, so it never touches anything you create.
  - **past days:** mostly delivered with realistic timings (about one in six late), some cancelled and rejected
  - **today:** spread across the boards, with the earliest drops already out for delivery to driver@test.com
  - **future days:** confirmed if their cut-off has passed, otherwise placed, with a few drafts
- **Every demo order goes through the real rules:** the employee's own menu and the same `buildLines()` the API uses. Demo orders are always priced on the right tier and respect hidden items and required choices.
- **Weekends:** the demo kitchen works seven days, Orbit Health (a hospital) orders every day and Bluepeak Monday to Saturday, so a weekend review still has deliveries.
- **History stays realistic:** with no one working the boards over the two-week review, unfinished orders from past days are marked delivered overnight. This is a demo convenience, not something the real product would do, which is why it only runs in demo mode.

Things in the demo data worth looking at:
- the Startup tier, which is missing prices on 6 dishes and has no price for Chicken tikka, so Nimbus Labs sees a smaller menu
- Kaveri Consulting, a vegetarian office with the chicken dishes hidden
- the secret "Chef's Specials" category
- Gulab Jamun, which has no station and shows as "Unassigned"
- the deactivated Ragi Brownie
- Acme's Dussehra holiday
- an Enterprise-tier price override on the Dal Makhani Thali
