import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';
import { AppError, ErrorCode } from '../http/app-error';

export const ADMIN_KEY_HEADER = 'x-admin-key';

/** Sandbox-grade protection for /admin routes: a shared static key from the environment. */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const provided = context.switchToHttp().getRequest<Request>().header(ADMIN_KEY_HEADER) ?? '';
    const expected = this.config.get('ADMIN_API_KEY');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid admin key', HttpStatus.UNAUTHORIZED);
    }
    return true;
  }
}
