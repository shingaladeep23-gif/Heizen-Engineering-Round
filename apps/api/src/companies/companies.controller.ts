import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { companySchema, employeeSchema } from '@fernleaf/shared';
import type { z } from 'zod';
import { Can } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';
import { CompaniesService } from './companies.service.js';

@Controller()
export class CompaniesController {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompaniesService,
  ) {}

  @Get('companies')
  @Can('orders.view') // the order list filters by company
  list() {
    return this.companies.list();
  }

  @Get('companies/:id')
  @Can('companies.view')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.companies.detail(id);
  }

  @Post('companies')
  @Can('companies.manage')
  create(@Body(new ZodPipe(companySchema)) input: z.output<typeof companySchema>) {
    return this.companies.save(null, input);
  }

  @Put('companies/:id')
  @Can('companies.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(companySchema)) input: z.output<typeof companySchema>,
  ) {
    return this.companies.save(id, input);
  }

  @Get('employees')
  @Can('companies.view')
  employees() {
    return this.db.employee.findMany({
      orderBy: [{ company: { name: 'asc' } }, { name: 'asc' }],
      select: { id: true, name: true, email: true, company: { select: { id: true, name: true } } },
    });
  }

  @Post('employees')
  @Can('companies.manage')
  createEmployee(@Body(new ZodPipe(employeeSchema)) input: z.output<typeof employeeSchema>) {
    return this.companies.saveEmployee(null, input);
  }

  @Put('employees/:id')
  @Can('companies.manage')
  updateEmployee(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(employeeSchema)) input: z.output<typeof employeeSchema>,
  ) {
    return this.companies.saveEmployee(id, input);
  }
}
