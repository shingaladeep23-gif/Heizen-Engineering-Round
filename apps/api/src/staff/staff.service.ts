import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { can, ROLES, type StaffInput, type StaffUpdate } from '@fernleaf/shared';
import type { User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { toMe } from '../auth/auth.service.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class StaffService {
  constructor(private readonly db: PrismaService) {}

  async list() {
    const users = await this.db.user.findMany({
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    return users.map((u) => ({ ...toMe(u), active: u.active }));
  }

  async create(input: StaffInput) {
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

  /**
   * Change someone's role, or switch their account off or on. Switching off
   * takes effect at once: sign-in refuses it and every request reloads the user.
   */
  async update(me: User, id: number, input: StaffUpdate) {
    if (id === me.id && (input.role !== me.role || !input.active)) {
      throw new BadRequestException({
        message: "You can't change your own role or switch yourself off",
      });
    }
    return this.db.$transaction(async (tx) => {
      // One staff change at a time. Otherwise two admins switching each other
      // off at the same moment would both see "someone else can still manage
      // staff", and both succeed, leaving nobody who can.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1001)`;
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw new NotFoundException({ message: 'Staff member not found' });

      // Someone must always be able to manage staff, or nobody could fix it.
      const managers = ROLES.filter((role) => can(role, 'staff.manage'));
      const losesIt =
        user.active &&
        managers.includes(user.role) &&
        (!input.active || !managers.includes(input.role));
      if (losesIt) {
        const others = await tx.user.count({
          where: { id: { not: id }, active: true, role: { in: managers } },
        });
        if (others === 0) {
          throw new BadRequestException({
            message: 'This is the last account that can manage staff',
          });
        }
      }
      const updated = await tx.user.update({ where: { id }, data: input });
      return { ...toMe(updated), active: updated.active };
    });
  }
}
