import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';
import { AppError, ErrorCode } from '../http/app-error';

export const ADMIN_KEY_HEADER = 'x-admin-key';

/** Constant-time comparison of the request's admin key header with the configured key. */
export function hasAdminKey(req: Request, expected: string): boolean {
  const a = Buffer.from(req.header(ADMIN_KEY_HEADER) ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Sandbox-grade protection for /admin routes: a shared static key from the environment. */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!hasAdminKey(req, this.config.get('ADMIN_API_KEY'))) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid admin key', HttpStatus.UNAUTHORIZED);
    }
    return true;
  }
}
