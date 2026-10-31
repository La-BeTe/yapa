import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { Envelope, success } from './envelope';
import { RESPONSE_MESSAGE } from './response-message.decorator';

/** Marks a handler result as an already-built envelope (e.g. an idempotent replay). */
export class RawEnvelope<T> {
  constructor(readonly envelope: Envelope<T>) {}
}

/** A handler result whose envelope carries `meta` (e.g. pagination) next to `data`. */
export class WithMeta<T> {
  constructor(
    readonly data: T,
    readonly meta: Record<string, unknown>,
  ) {}
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const message =
      this.reflector.getAllAndOverride<string | undefined>(RESPONSE_MESSAGE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'OK';

    return next.handle().pipe(
      map((body: unknown) => {
        if (body instanceof RawEnvelope) {
          return body.envelope;
        }
        if (body instanceof WithMeta) {
          return success(message, body.data, body.meta);
        }
        return success(message, body ?? null);
      }),
    );
  }
}
