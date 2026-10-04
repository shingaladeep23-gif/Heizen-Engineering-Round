import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module.js';
import { DemoDataService } from './demo-data.service.js';

@Module({
  imports: [MenuModule],
  providers: [DemoDataService],
})
export class DemoDataModule {}
