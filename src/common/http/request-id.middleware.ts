import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { isUlid, newId } from '../ids/ulid';

export const REQUEST_ID_HEADER = 'x-request-id';

declare module 'express' {
  interface Request {
    requestId?: string;
    startedAt?: number;
  }
}

/** Assigns every request a ULID request id (client-supplied if it is a valid ULID) and echoes it. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId = isUlid(incoming) ? incoming.toUpperCase() : newId();
    req.requestId = requestId;
    req.startedAt = Date.now();
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
