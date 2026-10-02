import { Body, ConflictException, Controller, Get, Post } from '@nestjs/common';
import { staffSchema, type StaffInput } from '@fernleaf/shared';
import bcrypt from 'bcryptjs';
import { toMe } from '../auth/auth.controller.js';
import { Can } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';

@Controller('staff')
export class StaffController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  @Can('staff.manage')
  async list() {
    const users = await this.db.user.findMany({
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    return users.map((u) => ({ ...toMe(u), active: u.active }));
  }

  @Post()
  @Can('staff.manage')
  async create(@Body(new ZodPipe(staffSchema)) input: StaffInput) {
    const email = input.email.toLowerCase();
    if (await this.db.user.findUnique({ where: { email } })) {
      throw new ConflictException({
        message: 'That email is already in use',
        fieldErrors: { email: 'Already in use' },
      });
    }
    const user = await this.db.user.create({
      data: {
        name: input.name,
        email,
        role: input.role,
        passwordHash: await bcrypt.hash(input.password, 10),
      },
    });
    return toMe(user);
  }
}
