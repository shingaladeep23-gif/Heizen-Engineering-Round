import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { PrismaModule } from './prisma.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [AppController],
})
export class AppModule {}
