import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import bcrypt from 'bcryptjs';
import { MenuService } from '../menu/menu.service.js';
import { PrismaService } from '../prisma.service.js';
import {
  addMissingDishImages,
  addPortionsOnce,
  seedCatalogue,
  seedMissingCompanies,
} from './catalogue-seed.js';
import { DemoOrders } from './demo-orders.js';

// The live app must always have the reviewers' test accounts and realistic
// data (spec section 2). Runs on every start and only fills in what's
// missing, so it never undoes changes made through the app.
const TEST_ACCOUNTS = [
  { email: 'admin@test.com', name: 'Asha Admin', role: 'ADMIN' },
  { email: 'kitchen@test.com', name: 'Karan Kitchen', role: 'KITCHEN' },
  { email: 'dispatch@test.com', name: 'Divya Dispatch', role: 'DISPATCH' },
  { email: 'driver@test.com', name: 'Dev Driver', role: 'DRIVER' },
] as const;

// Order history and a live-looking "today" are only generated on the demo
// site (DEMO_MODE=true). Locally they'd get in the way of the tests.
const DEMO_MODE = process.env.DEMO_MODE === 'true';

@Injectable()
export class DemoDataService implements OnApplicationBootstrap {
  private readonly log = new Logger(DemoDataService.name);
  private readonly orders: DemoOrders;

  constructor(
    private readonly db: PrismaService,
    menus: MenuService,
  ) {
    this.orders = new DemoOrders(db, menus);
  }

  async onApplicationBootstrap() {
    await this.db.settings.upsert({ where: { id: 1 }, create: {}, update: {} });

    const passwordHash = await bcrypt.hash('Test@1234', 10);
    for (const account of TEST_ACCOUNTS) {
      await this.db.user.upsert({
        where: { email: account.email },
        create: { ...account, passwordHash },
        update: {},
      });
    }

    const driver = await this.db.user.findUniqueOrThrow({ where: { email: 'driver@test.com' } });
    if ((await this.db.dish.count()) === 0) {
      await seedCatalogue(this.db, driver.id);
      this.log.log('Seeded the demo catalogue, companies and employees');
    }
    if (await addPortionsOnce(this.db)) this.log.log('Added portion sizes to the protein bowl');

    if (DEMO_MODE) {
      await seedMissingCompanies(this.db, driver.id);
      await addMissingDishImages(this.db);
      if ((await this.db.invoice.count()) === 0) {
        // A fresh demo: the kitchen cooks every day, so whatever day the
        // review is on, the hospital client still has deliveries.
        await this.db.settings.update({
          where: { id: 1 },
          data: { kitchenWorkingDays: [1, 2, 3, 4, 5, 6, 7] },
        });
      }
      // Generating orders can take a few minutes against a remote database,
      // so it runs in the background: the API starts listening straight away.
      void this.refresh();
    }
    this.log.log('Demo data is in place');
  }

  // Hourly: make sure today and the coming week have orders, and wrap up
  // past days. Cheap when there's nothing to do. Never runs twice at once.
  private refreshing = false;

  @Interval(60 * 60_000)
  async refresh() {
    if (!DEMO_MODE || this.refreshing) return;
    this.refreshing = true;
    try {
      const completed = await this.orders.completePastDays();
      const created = await this.orders.topUp();
      const staged = await this.orders.stageTodayOnce();
      if (completed || created || staged) {
        this.log.log(
          `Demo refresh: ${created} new orders, ${completed} past orders wrapped up, ${staged} of today's staged`,
        );
      }
    } catch (error) {
      this.log.error(`Demo refresh failed: ${String(error)}`);
    } finally {
      this.refreshing = false;
    }
  }
}
