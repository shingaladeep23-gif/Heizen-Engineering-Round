import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth.guard.js';
import { PrismaService } from './prisma.service.js';

@Controller()
export class AppController {
  constructor(private readonly db: PrismaService) {}

  // Used by the uptime pinger and to check the database is reachable.
  @Public()
  @Get('health')
  async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}
