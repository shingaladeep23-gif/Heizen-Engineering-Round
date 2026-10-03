import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    // Prisma's default 5s limit for a transaction is too tight here: every
    // query is a round trip from Render to Neon, and Neon's free database
    // takes a moment to wake up after being idle. Saving a company is ~10
    // queries in one transaction.
    super({ transactionOptions: { maxWait: 10_000, timeout: 30_000 } });
  }

  async onModuleInit() {
    await this.$connect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
