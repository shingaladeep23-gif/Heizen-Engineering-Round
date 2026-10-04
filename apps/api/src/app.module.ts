import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { BillingModule } from './billing/billing.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { DemoDataModule } from './demo-data/demo-data.module.js';
import { DispatchModule } from './dispatch/dispatch.module.js';
import { KitchenModule } from './kitchen/kitchen.module.js';
import { MenuModule } from './menu/menu.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PricingModule } from './pricing/pricing.module.js';
import { PrismaErrorFilter } from './prisma-error.filter.js';
import { PrismaModule } from './prisma.service.js';
import { SettingsModule } from './settings/settings.module.js';
import { StaffModule } from './staff/staff.module.js';

// One module per area of the business. Each exports only the service other
// areas use: menus (for orders and demo data), orders (for the kitchen,
// dispatch and the dashboard), and dispatch, billing and pricing (for the
// admin dashboard). The database client is a global module.
@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot(),
    AuthModule,
    StaffModule,
    CatalogueModule,
    PricingModule,
    MenuModule,
    CompaniesModule,
    OrdersModule,
    KitchenModule,
    DispatchModule,
    BillingModule,
    SettingsModule,
    DashboardModule,
    DemoDataModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_FILTER, useClass: PrismaErrorFilter }],
})
export class AppModule {}
