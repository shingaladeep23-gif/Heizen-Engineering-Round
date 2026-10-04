import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { loginSchema, type LoginInput } from '@fernleaf/shared';
import type { User } from '@prisma/client';
import type { Request, Response } from 'express';
import { ZodPipe } from '../zod.pipe.js';
import { CurrentUser, Public } from './auth.guard.js';
import { AuthService, toMe } from './auth.service.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) { email, password }: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Behind Vercel and Render, the browser's address is the first one forwarded.
    const from = String(req.headers['x-forwarded-for'] ?? req.ip)
      .split(',')[0]
      .trim();
    const user = await this.auth.check(email, password, from);
    const token = await this.jwt.signAsync({ sub: user.id }, { expiresIn: '7d' });
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
