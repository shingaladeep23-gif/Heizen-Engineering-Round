import { Controller, Get } from '@nestjs/common';
import { Can } from '../auth/auth.guard.js';
import { DashboardService } from './dashboard.service.js';

// The kitchen and dispatch dashboards summarise their boards' own data, so
// only the admin dashboard needs an endpoint of its own.
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('admin')
  @Can('billing.view')
  admin() {
    return this.dashboard.admin();
  }
}
