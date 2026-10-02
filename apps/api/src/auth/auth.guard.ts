import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { can, type Permission } from '@fernleaf/shared';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';

export const Public = () => SetMetadata('public', true);
export const Can = (permission: Permission) => SetMetadata('permission', permission);
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest().user,
);

// Runs on every request. Everything needs a signed-in user unless marked
// @Public(), and a route marked @Can('x') also needs that permission.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('public', targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const userId = await this.jwt
      .verifyAsync<{ sub: number }>(req.cookies?.session ?? '')
      .then((payload) => payload.sub)
      .catch(() => null);
    // Load the user every time so a role change or deactivation applies at once.
    const user = userId ? await this.db.user.findUnique({ where: { id: userId } }) : null;
    if (!user?.active) throw new UnauthorizedException({ message: 'Please sign in' });
    req.user = user;

    const permission = this.reflector.getAllAndOverride<Permission>('permission', targets);
    if (permission && !can(user.role, permission)) {
      throw new ForbiddenException({
        message: "You don't have access to this",
      });
    }
    return true;
  }
}
