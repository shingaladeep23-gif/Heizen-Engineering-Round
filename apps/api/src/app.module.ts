import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { BillingController } from './billing/billing.controller.js';
import { BillingService } from './billing/billing.service.js';
import { CatalogueController } from './catalogue/catalogue.controller.js';
import { CompaniesController } from './companies/companies.controller.js';
import { CompaniesService } from './companies/companies.service.js';
import { DispatchController } from './dispatch/dispatch.controller.js';
import { DispatchService } from './dispatch/dispatch.service.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { DashboardService } from './dashboard/dashboard.service.js';
import { DemoDataService } from './demo-data/demo-data.service.js';
import { KitchenController } from './kitchen/kitchen.controller.js';
import { KitchenService } from './kitchen/kitchen.service.js';
import { MenuController } from './menu/menu.controller.js';
import { MenuService } from './menu/menu.service.js';
import { OrdersController } from './orders/orders.controller.js';
import { OrdersService } from './orders/orders.service.js';
import { PricingController } from './pricing/pricing.controller.js';
import { PrismaErrorFilter } from './prisma-error.filter.js';
import { PrismaModule } from './prisma.service.js';
import { SettingsController } from './settings/settings.controller.js';
import { StaffController } from './staff/staff.controller.js';

@Module({
  imports: [PrismaModule, AuthModule, ScheduleModule.forRoot()],
  controllers: [
    AppController,
    StaffController,
    CatalogueController,
    PricingController,
    MenuController,
    CompaniesController,
    OrdersController,
    KitchenController,
    DispatchController,
    BillingController,
    SettingsController,
    DashboardController,
  ],
  providers: [
    DemoDataService,
    MenuService,
    OrdersService,
    KitchenService,
    DispatchService,
    BillingService,
    CompaniesService,
    DashboardService,
    { provide: APP_FILTER, useClass: PrismaErrorFilter },
  ],
})
export class AppModule {}
