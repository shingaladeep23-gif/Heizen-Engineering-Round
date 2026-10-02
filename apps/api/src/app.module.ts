import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogueController } from './catalogue/catalogue.controller.js';
import { CompaniesController } from './companies/companies.controller.js';
import { DemoDataService } from './demo-data/demo-data.service.js';
import { MenuController } from './menu/menu.controller.js';
import { MenuService } from './menu/menu.service.js';
import { PricingController } from './pricing/pricing.controller.js';
import { PrismaErrorFilter } from './prisma-error.filter.js';
import { PrismaModule } from './prisma.service.js';
import { StaffController } from './staff/staff.controller.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [
    AppController,
    StaffController,
    CatalogueController,
    PricingController,
    MenuController,
    CompaniesController,
  ],
  providers: [DemoDataService, MenuService, { provide: APP_FILTER, useClass: PrismaErrorFilter }],
})
export class AppModule {}
