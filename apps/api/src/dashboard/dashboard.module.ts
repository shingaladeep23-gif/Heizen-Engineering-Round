import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [OrdersModule, DispatchModule, BillingModule, PricingModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
