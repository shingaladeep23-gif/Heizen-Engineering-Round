import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { DemoDataService } from './demo-data.service.js';
import { PrismaModule } from './prisma.service.js';
import { StaffController } from './staff/staff.controller.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AppController, StaffController],
  providers: [DemoDataService],
})
export class AppModule {}
