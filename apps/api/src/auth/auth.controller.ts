import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { loginSchema, type LoginInput, type Me } from '@fernleaf/shared';
import type { User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { Response } from 'express';
import { PrismaService } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';
import { CurrentUser, Public } from './auth.guard.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const toMe = ({ id, name, email, role }: User): Me => ({
  id,
  name,
  email,
  role,
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) { email, password }: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.db.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    const ok =
      user?.active && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !ok)
      throw new UnauthorizedException({ message: 'Wrong email or password' });

    const token = await this.jwt.signAsync(
      { sub: user.id },
      { expiresIn: '7d' },
    );
    // httpOnly: page scripts can't read it. Browsers allow Secure on localhost too.
    res.cookie('session', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: WEEK_MS,
    });
    return toMe(user);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('session');
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return toMe(user);
  }
}
