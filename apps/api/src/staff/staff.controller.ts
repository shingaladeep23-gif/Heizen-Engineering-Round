import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import {
  staffSchema,
  staffUpdateSchema,
  type StaffInput,
  type StaffUpdate,
} from '@fernleaf/shared';
import type { User } from '@prisma/client';
import { Can, CurrentUser } from '../auth/auth.guard.js';
import { IdPipe } from '../id.pipe.js';
import { ZodPipe } from '../zod.pipe.js';
import { StaffService } from './staff.service.js';

@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @Can('staff.manage')
  list() {
    return this.staff.list();
  }

  @Post()
  @Can('staff.manage')
  create(@Body(new ZodPipe(staffSchema)) input: StaffInput) {
    return this.staff.create(input);
  }

  @Put(':id')
  @Can('staff.manage')
  update(
    @CurrentUser() me: User,
    @Param('id', IdPipe) id: number,
    @Body(new ZodPipe(staffUpdateSchema)) input: StaffUpdate,
  ) {
    return this.staff.update(me, id, input);
  }
}
