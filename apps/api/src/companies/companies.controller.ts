import { Controller, Get } from '@nestjs/common';
import { Can } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma.service.js';

@Controller()
export class CompaniesController {
  constructor(private readonly db: PrismaService) {}

  @Get('companies')
  @Can('orders.view')
  companies() {
    return this.db.company.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
  }

  @Get('employees')
  @Can('companies.view')
  employees() {
    return this.db.employee.findMany({
      orderBy: [{ company: { name: 'asc' } }, { name: 'asc' }],
      select: { id: true, name: true, email: true, company: { select: { id: true, name: true } } },
    });
  }
}
