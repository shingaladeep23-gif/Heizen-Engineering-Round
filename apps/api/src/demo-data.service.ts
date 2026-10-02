import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from './prisma.service.js';

// The live app must always have the reviewers' test accounts (spec section 2).
// Runs on every start and only creates what's missing, so it never undoes
// changes made through the app.
const TEST_ACCOUNTS = [
  { email: 'admin@test.com', name: 'Asha Admin', role: 'ADMIN' },
  { email: 'kitchen@test.com', name: 'Karan Kitchen', role: 'KITCHEN' },
  { email: 'dispatch@test.com', name: 'Divya Dispatch', role: 'DISPATCH' },
  { email: 'driver@test.com', name: 'Dev Driver', role: 'DRIVER' },
] as const;

@Injectable()
export class DemoDataService implements OnApplicationBootstrap {
  private readonly log = new Logger(DemoDataService.name);

  constructor(private readonly db: PrismaService) {}

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
    this.log.log('Test accounts and settings are in place');
  }
}
