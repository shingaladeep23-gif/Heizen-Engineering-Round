import { HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Me } from '@fernleaf/shared';
import type { User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma.service.js';

// What the browser may know about a staff member: never the password hash.
export const toMe = ({ id, name, email, role }: User): Me => ({ id, name, email, role });

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;

@Injectable()
export class AuthService {
  constructor(private readonly db: PrismaService) {}

  // Recent failed sign-ins per email and address. Kept in memory, which is
  // enough for one API instance; several would need to share it (database
  // or Redis).
  private readonly failures = new Map<string, number[]>();

  /**
   * The user for these credentials, or a 401 that doesn't say which part was
   * wrong. After 10 failures in 15 minutes for one email from one address,
   * further tries are refused for a while, so passwords can't be guessed
   * at speed.
   */
  async check(email: string, password: string, from: string, now = Date.now()) {
    const key = `${email.toLowerCase()}|${from}`;
    const recent = (this.failures.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
    if (recent.length >= MAX_FAILURES) {
      throw new HttpException(
        { message: 'Too many failed sign-ins. Try again in a few minutes.' },
        429,
      );
    }
    const user = await this.db.user.findUnique({ where: { email: email.toLowerCase() } });
    const ok = user?.active && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !ok) {
      this.failures.set(key, [...recent, now]);
      throw new UnauthorizedException({ message: 'Wrong email or password' });
    }
    this.failures.delete(key);
    return user;
  }
}
