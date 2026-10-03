import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    // Prisma's default 5s limit for a transaction is too tight here: every
    // query is a round trip from Render to Neon, and Neon's free database
    // takes a moment to wake up after being idle. Saving a company is ~10
    // queries in one transaction.
    // The default connection pool is sized for the CPU count (tiny on a free
    // instance), so the dashboard's parallel queries would queue. Allow 10.
    const url = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost');
    if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '10');
    super({
      datasourceUrl: url.toString(),
      transactionOptions: { maxWait: 10_000, timeout: 30_000 },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
